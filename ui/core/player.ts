import Toast from './components/toast';
import { getLanguageCode } from './constants/lang.js';
import * as Mechanics from './constants/mechanics.js';
import { SimSettingCategories } from './constants/sim_settings';
import { MAX_PARTY_SIZE, Party } from './party.js';
import {
	AuraStats as AuraStatsProto,
	ErrorOutcomeType,
	Player as PlayerProto,
	PlayerStats,
	SpellStats as SpellStatsProto,
	StatWeightsResult,
	UnitMetadata as UnitMetadataProto,
} from './proto/api.js';
import { APLRotation, APLRotation_Type as APLRotationType, SimpleRotation } from './proto/apl.js';
import {
	Class,
	Consumes,
	Cooldowns,
	Faction,
	HandType,
	HealingModel,
	IndividualBuffs,
	ItemRandomSuffix,
	ItemSlot,
	Profession,
	PseudoStat,
	Race,
	SimDatabase,
	Spec,
	Stat,
	UnitReference,
	UnitStats,
	WeaponType,
} from './proto/common.js';
import {
	DungeonFilterOption,
	ExcludedZones,
	RaidFilterOption,
	SourceFilterOption,
	UIEnchant as Enchant,
	UIItem as Item,
	UIItem_FactionRestriction,
} from './proto/ui.js';
import { ActionId } from './proto_utils/action_id.js';
import { Database } from './proto_utils/database.js';
import { EquippedItem, getWeaponDPS } from './proto_utils/equipped_item.js';
import { Gear, ItemSwapGear } from './proto_utils/gear.js';
import { Stats } from './proto_utils/stats.js';
import {
	canEquipEnchant,
	canEquipItem,
	classColors,
	ClassSpecs,
	emptyUnitReference,
	enchantAppliesToItem,
	getTalentTree,
	getTalentTreeIcon,
	getTalentTreePoints,
	isTankSpec,
	newUnitReference,
	raceToFaction,
	SpecOptions,
	SpecRotation,
	SpecTalents,
	specToClass,
	specToEligibleRaces,
	SpecTypeFunctions,
	specTypeFunctions,
	withSpecProto,
} from './proto_utils/utils.js';
import { Raid } from './raid.js';
import { Sim } from './sim.js';
import { playerTalentStringToProto } from './talents/factory.js';
import { EventID, TypedEvent } from './typed_event.js';
import { stringComparator } from './utils.js';
import { WorkerProgressCallback } from './worker_pool';

export interface AuraStats {
	data: AuraStatsProto;
	id: ActionId;
}
export interface SpellStats {
	data: SpellStatsProto;
	id: ActionId;
}

export class UnitMetadata {
	private name: string;
	private auras: Array<AuraStats>;
	private spells: Array<SpellStats>;

	constructor() {
		this.name = '';
		this.auras = [];
		this.spells = [];
	}

	getName(): string {
		return this.name;
	}

	getAuras(): Array<AuraStats> {
		return this.auras.slice();
	}

	getSpells(): Array<SpellStats> {
		return this.spells.slice();
	}

	// Returns whether any updates were made.
	async update(metadata: UnitMetadataProto): Promise<boolean> {
		let newSpells = metadata!.spells.map(spell => {
			return {
				data: spell,
				id: ActionId.fromProto(spell.id!),
			};
		});
		let newAuras = metadata!.auras.map(aura => {
			return {
				data: aura,
				id: ActionId.fromProto(aura.id!),
			};
		});

		await Promise.all([...newSpells, ...newAuras].map(newSpell => newSpell.id.fill().then(newId => (newSpell.id = newId))));

		newSpells = newSpells.sort((a, b) => stringComparator(a.id.name, b.id.name));
		newAuras = newAuras.sort((a, b) => stringComparator(a.id.name, b.id.name));

		let anyUpdates = false;
		if (metadata.name !== this.name) {
			this.name = metadata.name;
			anyUpdates = true;
		}
		if (newSpells.length !== this.spells.length || newSpells.some((newSpell, i) => !newSpell.id.equals(this.spells[i].id))) {
			this.spells = newSpells;
			anyUpdates = true;
		}
		if (newAuras.length !== this.auras.length || newAuras.some((newAura, i) => !newAura.id.equals(this.auras[i].id))) {
			this.auras = newAuras;
			anyUpdates = true;
		}

		return anyUpdates;
	}
}

export class UnitMetadataList {
	private metadatas: Array<UnitMetadata>;

	constructor() {
		this.metadatas = [];
	}

	async update(newMetadatas: Array<UnitMetadataProto>): Promise<boolean> {
		const oldLen = this.metadatas.length;

		if (newMetadatas.length > oldLen) {
			for (let i = oldLen; i < newMetadatas.length; i++) {
				this.metadatas.push(new UnitMetadata());
			}
		} else if (newMetadatas.length < oldLen) {
			this.metadatas = this.metadatas.slice(0, newMetadatas.length);
		}

		const anyUpdates = await Promise.all(newMetadatas.map((metadata, i) => this.metadatas[i].update(metadata)));

		return oldLen !== this.metadatas.length || anyUpdates.some(v => v);
	}

	asList(): Array<UnitMetadata> {
		return this.metadatas.slice();
	}
}

export interface MeleeCritCapInfo {
	meleeCrit: number;
	meleeHit: number;
	expertise: number;
	glancing: number;
	suppression: number;
	debuffCrit: number;
	hasOffhandWeapon: boolean;
	meleeHitCap: number;
	remainingMeleeHitCap: number;
	dodgeCap: number;
	parryCap: number;
	baseCritCap: number;
	specSpecificOffset: number;
	playerCritCapDelta: number;
}

export type AutoRotationGenerator<SpecType extends Spec> = (player: Player<SpecType>) => APLRotation;
export type SimpleRotationGenerator<SpecType extends Spec> = (
	player: Player<SpecType>,
	simpleRotation: SpecRotation<SpecType>,
	cooldowns: Cooldowns,
) => APLRotation;

export interface PlayerConfig<SpecType extends Spec> {
	autoRotation: AutoRotationGenerator<SpecType>;
	simpleRotation?: SimpleRotationGenerator<SpecType>;
}

const SPEC_CONFIGS: Partial<Record<Spec, PlayerConfig<any>>> = {};

export function registerSpecConfig(spec: Spec, config: PlayerConfig<any>) {
	SPEC_CONFIGS[spec] = config;
}

export function getSpecConfig<SpecType extends Spec>(spec: SpecType): PlayerConfig<SpecType> {
	const config = SPEC_CONFIGS[spec] as PlayerConfig<SpecType>;
	if (!config) {
		throw new Error('No config registered for Spec: ' + spec);
	}
	return config;
}

// Manages all the gear / consumes / other settings for a single Player.
export class Player<SpecType extends Spec> {
	readonly sim: Sim;
	private party: Party | null;
	private raid: Raid | null;

	readonly spec: Spec;
	private name = '';
	private buffs: IndividualBuffs = IndividualBuffs.create();
	private consumes: Consumes = Consumes.create();
	private bonusStats: Stats = new Stats();
	private gear: Gear = new Gear({});
	//private bulkEquipmentSpec: BulkEquipmentSpec = BulkEquipmentSpec.create();
	private enableItemSwap = false;
	private itemSwapGear: ItemSwapGear = new ItemSwapGear({});
	private race: Race;
	private profession1: Profession = 0;
	private profession2: Profession = 0;
	aplRotation: APLRotation = APLRotation.create();
	private talentsString = '';
	private specOptions: SpecOptions<SpecType>;
	private reactionTime = 0;
	private channelClipDelay = 0;
	private inFrontOfTarget = false;
	private distanceFromTarget = 0;
	private healingModel: HealingModel = HealingModel.create();
	private healingEnabled = false;

	private isbSbFrequency = 3.0;
	private isbCrit = 25.0;
	private isbWarlocks = 1.0;
	private isbSpriests = 0;

	private stormstrikeFrequency = 20.0;
	private stormstrikeNatureAttackerFrequency = 4.0;

	private readonly autoRotationGenerator: AutoRotationGenerator<SpecType> | null = null;
	private readonly simpleRotationGenerator: SimpleRotationGenerator<SpecType> | null = null;

	private itemEPCache = new Array<Map<number, number>>();
	private randomSuffixEPCache = new Map<number, number>();
	private enchantEPCache = new Map<number, number>();
	private talents: SpecTalents<SpecType> | null = null;

	readonly specTypeFunctions: SpecTypeFunctions<SpecType>;

	private static readonly numEpRatios = 6;
	private epRatios: Array<number> = new Array<number>(Player.numEpRatios).fill(0);
	private epWeights: Stats = new Stats();
	private currentStats: PlayerStats = PlayerStats.create();
	private metadata: UnitMetadata = new UnitMetadata();
	private petMetadatas: UnitMetadataList = new UnitMetadataList();

	readonly nameChangeEmitter = new TypedEvent<void>('PlayerName');
	readonly buffsChangeEmitter = new TypedEvent<void>('PlayerBuffs');
	readonly consumesChangeEmitter = new TypedEvent<void>('PlayerConsumes');
	readonly bonusStatsChangeEmitter = new TypedEvent<void>('PlayerBonusStats');
	readonly gearChangeEmitter = new TypedEvent<void>('PlayerGear');
	readonly itemSwapChangeEmitter = new TypedEvent<void>('PlayerItemSwap');
	readonly professionChangeEmitter = new TypedEvent<void>('PlayerProfession');
	readonly raceChangeEmitter = new TypedEvent<void>('PlayerRace');
	readonly rotationChangeEmitter = new TypedEvent<void>('PlayerRotation');
	readonly talentsChangeEmitter = new TypedEvent<void>('PlayerTalents');
	readonly specOptionsChangeEmitter = new TypedEvent<void>('PlayerSpecOptions');
	readonly inFrontOfTargetChangeEmitter = new TypedEvent<void>('PlayerInFrontOfTarget');
	readonly distanceFromTargetChangeEmitter = new TypedEvent<void>('PlayerDistanceFromTarget');
	readonly healingModelChangeEmitter = new TypedEvent<void>('PlayerHealingModel');
	readonly epWeightsChangeEmitter = new TypedEvent<void>('PlayerEpWeights');
	readonly miscOptionsChangeEmitter = new TypedEvent<void>('PlayerMiscOptions');

	readonly currentStatsEmitter = new TypedEvent<void>('PlayerCurrentStats');
	readonly epRatiosChangeEmitter = new TypedEvent<void>('PlayerEpRatios');
	readonly epRefStatChangeEmitter = new TypedEvent<void>('PlayerEpRefStat');

	// Emits when any of the above emitters emit.
	readonly changeEmitter: TypedEvent<void>;

	constructor(spec: Spec, sim: Sim) {
		this.sim = sim;
		this.party = null;
		this.raid = null;

		this.spec = spec;
		this.race = specToEligibleRaces[this.spec][0];
		this.specTypeFunctions = specTypeFunctions[this.spec] as SpecTypeFunctions<SpecType>;
		this.specOptions = this.specTypeFunctions.optionsCreate();

		const specConfig = SPEC_CONFIGS[this.spec] as PlayerConfig<SpecType>;
		if (!specConfig) {
			throw new Error('Could not find spec config for spec: ' + this.spec);
		}

		this.autoRotationGenerator = specConfig.autoRotation;
		if (specConfig.simpleRotation) {
			this.simpleRotationGenerator = specConfig.simpleRotation;
		} else {
			this.simpleRotationGenerator = null;
		}

		for (let i = 0; i < ItemSlot.ItemSlotRanged + 1; ++i) {
			this.itemEPCache[i] = new Map();
		}

		this.changeEmitter = TypedEvent.onAny(
			[
				this.nameChangeEmitter,
				this.buffsChangeEmitter,
				this.consumesChangeEmitter,
				this.bonusStatsChangeEmitter,
				this.gearChangeEmitter,
				this.itemSwapChangeEmitter,
				this.professionChangeEmitter,
				this.raceChangeEmitter,
				this.rotationChangeEmitter,
				this.talentsChangeEmitter,
				this.specOptionsChangeEmitter,
				this.miscOptionsChangeEmitter,
				this.inFrontOfTargetChangeEmitter,
				this.distanceFromTargetChangeEmitter,
				this.healingModelChangeEmitter,
				this.epWeightsChangeEmitter,
				this.epRatiosChangeEmitter,
				this.epRefStatChangeEmitter,
			],
			'PlayerChange',
		);
	}

	getSpecIcon(): string {
		return getTalentTreeIcon(this.spec, this.getTalentsString());
	}

	getClass(): Class {
		return specToClass[this.spec];
	}

	getClassColor(): string {
		return classColors[this.getClass()];
	}

	isSpec<T extends Spec>(spec: T): this is Player<T> {
		return this.spec === spec;
	}
	isClass<T extends Class>(clazz: T): this is Player<ClassSpecs<T>> {
		return this.getClass() === clazz;
	}

	getParty(): Party | null {
		return this.party;
	}

	getRaid(): Raid | null {
		return this.raid;
	}

	// Returns this player's index within its party [0-4].
	getPartyIndex(): number {
		if (this.party === null) {
			throw new Error("Can't get party index for player without a party!");
		}

		return this.party.getPlayers().indexOf(this);
	}

	// Returns this player's index within its raid [0-24].
	getRaidIndex(): number {
		if (this.party === null) {
			throw new Error("Can't get raid index for player without a party!");
		}

		return this.party.getIndex() * MAX_PARTY_SIZE + this.getPartyIndex();
	}

	// This should only ever be called from party.
	setParty(newParty: Party | null) {
		if (newParty === null) {
			this.party = null;
			this.raid = null;
		} else {
			this.party = newParty;
			this.raid = newParty.raid;
		}
	}

	getOtherPartyMembers(): Array<Player<any>> {
		if (this.party === null) {
			return [];
		}

		return this.party.getPlayers().filter(player => player !== null && player !== this) as Array<Player<any>>;
	}

	// Returns all items that this player can wear in the given slot.
	getItems(slot: ItemSlot): Array<Item> {
		return this.sim.db.getItems(slot).filter(item => canEquipItem(this, item, slot));
	}

	// Returns all random suffixes that this player would be interested in for the given base item.
	getRandomSuffixes(item: Item): Array<ItemRandomSuffix> {
		const allSuffixes = item.randomSuffixOptions.map(id => this.sim.db.getRandomSuffixById(id)!);
		return allSuffixes.filter(suffix => this.computeRandomSuffixEP(suffix) > 0);
	}

	// Returns all enchants that this player can wear in the given slot.
	getEnchants(slot: ItemSlot): Array<Enchant> {
		return this.sim.db.getEnchants(slot).filter(enchant => canEquipEnchant(enchant, this));
	}

	getEpWeights(): Stats {
		return this.epWeights;
	}

	setEpWeights(eventID: EventID, newEpWeights: Stats) {
		this.epWeights = newEpWeights;
		this.epWeightsChangeEmitter.emit(eventID);

		this.enchantEPCache = new Map();
		this.randomSuffixEPCache = new Map();
		for (let i = 0; i < ItemSlot.ItemSlotRanged + 1; ++i) {
			this.itemEPCache[i] = new Map();
		}
	}

	getDefaultEpRatios(isTankSpec: boolean, isHealingSpec: boolean): Array<number> {
		const defaultRatios = new Array(Player.numEpRatios).fill(0);
		if (isHealingSpec) {
			// By default only value HPS EP for healing spec
			defaultRatios[1] = 1;
		} else if (isTankSpec) {
			// By default value TPS and DTPS EP equally for tanking spec
			defaultRatios[2] = 1;
			defaultRatios[3] = 1;
		} else {
			// By default only value DPS EP
			defaultRatios[0] = 1;
		}
		return defaultRatios;
	}

	getEpRatios() {
		return this.epRatios.slice();
	}

	setEpRatios(eventID: EventID, newRatios: Array<number>) {
		this.epRatios = newRatios;
		this.epRatiosChangeEmitter.emit(eventID);
	}

	async computeStatWeights(
		eventID: EventID,
		epStats: Array<Stat>,
		epPseudoStats: Array<PseudoStat>,
		epReferenceStat: Stat,
		onProgress: WorkerProgressCallback,
	): Promise<StatWeightsResult | null> {
		try {
			const result = await this.sim.statWeights(this, epStats, epPseudoStats, epReferenceStat, onProgress);
			if (result.error) {
				if (result.error.type === ErrorOutcomeType.ErrorOutcomeAborted) {
					new Toast({
						variant: 'info',
						body: 'Statweight sim cancelled.',
					});
				}
				return null;
			}
			return result;
		} catch (error: any) {
			// TODO: Show crash report like for raid sim?
			console.error(error);
			new Toast({
				variant: 'error',
				body: error?.message || 'Something went wrong calculating your stat weights. Reload the page and try again.',
			});
			return null;
		}
	}

	getCurrentStats(): PlayerStats {
		return PlayerStats.clone(this.currentStats);
	}

	setCurrentStats(eventID: EventID, newStats: PlayerStats) {
		this.currentStats = newStats;
		this.currentStatsEmitter.emit(eventID);
	}

	getMetadata(): UnitMetadata {
		return this.metadata;
	}

	getPetMetadatas(): UnitMetadataList {
		return this.petMetadatas;
	}

	async updateMetadata(): Promise<boolean> {
		const playerPromise = this.metadata.update(this.currentStats.metadata!);
		const petsPromise = this.petMetadatas.update(this.currentStats.pets.map(p => p.metadata!));
		const playerUpdated = await playerPromise;
		const petsUpdated = await petsPromise;
		return playerUpdated || petsUpdated;
	}

	getName(): string {
		return this.name;
	}
	setName(eventID: EventID, newName: string) {
		if (newName !== this.name) {
			this.name = newName;
			this.nameChangeEmitter.emit(eventID);
		}
	}

	getLabel(): string {
		if (this.party) {
			return `${this.name} (#${this.getRaidIndex() + 1})`;
		} else {
			return this.name;
		}
	}

	getRace(): Race {
		return this.race;
	}
	setRace(eventID: EventID, newRace: Race) {
		if (newRace !== this.race) {
			this.race = newRace;
			this.raceChangeEmitter.emit(eventID);
		}
	}

	getProfession1(): Profession {
		return this.profession1;
	}
	setProfession1(eventID: EventID, newProfession: Profession) {
		if (newProfession !== this.profession1) {
			this.profession1 = newProfession;
			this.professionChangeEmitter.emit(eventID);
		}
	}
	getProfession2(): Profession {
		return this.profession2;
	}
	setProfession2(eventID: EventID, newProfession: Profession) {
		if (newProfession !== this.profession2) {
			this.profession2 = newProfession;
			this.professionChangeEmitter.emit(eventID);
		}
	}
	getProfessions(): Array<Profession> {
		return [this.profession1, this.profession2].filter(p => p !== Profession.ProfessionUnknown);
	}
	setProfessions(eventID: EventID, newProfessions: Array<Profession>) {
		TypedEvent.freezeAllAndDo(() => {
			this.setProfession1(eventID, newProfessions[0] || Profession.ProfessionUnknown);
			this.setProfession2(eventID, newProfessions[1] || Profession.ProfessionUnknown);
		});
	}
	hasProfession(prof: Profession): boolean {
		return this.getProfessions().includes(prof);
	}
	isBlacksmithing(): boolean {
		return this.hasProfession(Profession.Blacksmithing);
	}

	getFaction(): Faction {
		return raceToFaction[this.getRace()];
	}

	getBuffs(): IndividualBuffs {
		// Make a defensive copy
		return IndividualBuffs.clone(this.buffs);
	}

	setBuffs(eventID: EventID, newBuffs: IndividualBuffs) {
		if (IndividualBuffs.equals(this.buffs, newBuffs)) return;

		// Make a defensive copy
		this.buffs = IndividualBuffs.clone(newBuffs);
		this.buffsChangeEmitter.emit(eventID);
	}

	getConsumes(): Consumes {
		// Make a defensive copy
		return Consumes.clone(this.consumes);
	}

	setConsumes(eventID: EventID, newConsumes: Consumes) {
		if (Consumes.equals(this.consumes, newConsumes)) return;

		// Make a defensive copy
		this.consumes = Consumes.clone(newConsumes);
		this.consumesChangeEmitter.emit(eventID);
	}

	equipItem(eventID: EventID, slot: ItemSlot, newItem: EquippedItem | null) {
		this.setGear(eventID, this.gear.withEquippedItem(slot, newItem));
	}

	getEquippedItem(slot: ItemSlot): EquippedItem | null {
		return this.gear.getEquippedItem(slot);
	}

	getGear(): Gear {
		return this.gear;
	}

	setGear(eventID: EventID, newGear: Gear) {
		if (newGear.equals(this.gear)) return;

		this.gear = newGear;
		this.gearChangeEmitter.emit(eventID);
	}

	getEnableItemSwap(): boolean {
		return this.enableItemSwap;
	}

	setEnableItemSwap(eventID: EventID, newEnableItemSwap: boolean) {
		if (newEnableItemSwap === this.enableItemSwap) return;

		this.enableItemSwap = newEnableItemSwap;
		this.itemSwapChangeEmitter.emit(eventID);
	}

	equipItemSwapitem(eventID: EventID, slot: ItemSlot, newItem: EquippedItem | null) {
		this.setItemSwapGear(eventID, this.itemSwapGear.withEquippedItem(slot, newItem));
	}

	getItemSwapItem(slot: ItemSlot): EquippedItem | null {
		return this.itemSwapGear.getEquippedItem(slot);
	}

	getItemSwapGear(): ItemSwapGear {
		return this.itemSwapGear;
	}

	setItemSwapGear(eventID: EventID, newItemSwapGear: ItemSwapGear) {
		if (newItemSwapGear.equals(this.itemSwapGear)) return;

		this.itemSwapGear = newItemSwapGear;
		this.itemSwapChangeEmitter.emit(eventID);
	}

	/*
	setBulkEquipmentSpec(eventID: EventID, newBulkEquipmentSpec: BulkEquipmentSpec) {
		if (BulkEquipmentSpec.equals(this.bulkEquipmentSpec, newBulkEquipmentSpec))
			return;

		TypedEvent.freezeAllAndDo(() => {
			this.bulkEquipmentSpec = newBulkEquipmentSpec;
			this.bulkGearChangeEmitter.emit(eventID);
		});
	}

	getBulkEquipmentSpec(): BulkEquipmentSpec {
		return BulkEquipmentSpec.clone(this.bulkEquipmentSpec);
	}
	*/

	getBonusStats(): Stats {
		return this.bonusStats;
	}

	setBonusStats(eventID: EventID, newBonusStats: Stats) {
		if (newBonusStats.equals(this.bonusStats)) return;

		this.bonusStats = newBonusStats;
		this.bonusStatsChangeEmitter.emit(eventID);
	}

	getMeleeCritCapInfo(weapon: WeaponType, useDWPenalty?: boolean): MeleeCritCapInfo {
		let targetLevel = 63; // Initializes at level 63 until UI is loaded
		if (this.sim.encounter.targets) {
			targetLevel = this.sim.encounter?.primaryTarget.level;
		}

		const has2hWeapon = this.getGear().hasTwoHandedWeapon();
		const hasOffhandWeapon = this.getGear().hasOffHandWeapon();

		const levelDiff = targetLevel - Mechanics.MAX_CHARACTER_LEVEL;
		const defenderDefense = targetLevel * 5;
		const glancing = (1 + levelDiff) * 10.0;
		const suppression = levelDiff === 3 ? levelDiff + 1.8 : levelDiff;

		let weaponSkill = 300.0;
		const meleeCrit = (this.currentStats.finalStats?.stats[Stat.StatMeleeCrit] || 0.0) / Mechanics.MELEE_CRIT_RATING_PER_CRIT_CHANCE;
		const meleeHit = (this.currentStats.finalStats?.stats[Stat.StatMeleeHit] || 0.0) / Mechanics.MELEE_HIT_RATING_PER_HIT_CHANCE;
		const expertise = (this.currentStats.finalStats?.stats[Stat.StatExpertise] || 0.0) / Mechanics.EXPERTISE_PER_QUARTER_PERCENT_REDUCTION / 4;

		const getWeaponSkillForWeaponType = (skill: PseudoStat) => this.currentStats.talentsStats?.pseudoStats[skill] || 0.0;

		if (!has2hWeapon) {
			switch (weapon) {
				case WeaponType.WeaponTypeUnknown:
					break;
				case WeaponType.WeaponTypeAxe:
					weaponSkill += getWeaponSkillForWeaponType(PseudoStat.PseudoStatAxesSkill);
					break;
				case WeaponType.WeaponTypeDagger:
					weaponSkill += getWeaponSkillForWeaponType(PseudoStat.PseudoStatDaggersSkill);
					break;
				case WeaponType.WeaponTypeFist:
					weaponSkill += getWeaponSkillForWeaponType(PseudoStat.PseudoStatUnarmedSkill);
					break;
				case WeaponType.WeaponTypeMace:
					weaponSkill += getWeaponSkillForWeaponType(PseudoStat.PseudoStatMacesSkill);
					break;
				case WeaponType.WeaponTypeSword:
					weaponSkill += getWeaponSkillForWeaponType(PseudoStat.PseudoStatSwordsSkill);
					break;
			}
		}
		if (has2hWeapon) {
			switch (weapon) {
				case WeaponType.WeaponTypeUnknown:
					break;
				case WeaponType.WeaponTypeAxe:
					weaponSkill += getWeaponSkillForWeaponType(PseudoStat.PseudoStatTwoHandedAxesSkill);
					break;
				case WeaponType.WeaponTypeMace:
					weaponSkill += getWeaponSkillForWeaponType(PseudoStat.PseudoStatTwoHandedMacesSkill);
					break;
				case WeaponType.WeaponTypeSword:
					weaponSkill += getWeaponSkillForWeaponType(PseudoStat.PseudoStatTwoHandedSwordsSkill);
					break;
			}
		}

		const skillDiff = defenderDefense - weaponSkill;
		// Due to warrior HS bug, hit cap for crit cap calculation ignores the 19% penalty
		let meleeHitCap = skillDiff <= 10 ? 5.0 + skillDiff * 0.1 : 5.0 + skillDiff * 0.2 + (skillDiff - 10) * 0.2;
		meleeHitCap = this.getGear().isDualWielding() && (this.spec !== Spec.SpecWarrior || useDWPenalty) ? meleeHitCap + 19.0 : meleeHitCap + 0.0;

		const dodgeCap = 5.0 + skillDiff * 0.1;
		let parryCap = 0.0;
		if (this.getInFrontOfTarget()) {
			parryCap = levelDiff === 3 ? 14.0 : 5.0 + skillDiff * 0.1; // 14% parry at +3 level and follows dodge scaling otherwise
		}
		const remainingMeleeHitCap = Math.max(meleeHitCap - meleeHit, 0.0);
		const remainingDodgeCap = Math.max(dodgeCap - expertise, 0.0);
		const remainingParryCap = Math.max(parryCap - expertise, 0.0);
		const remainingExpertiseCap = remainingDodgeCap + remainingParryCap;

		let specSpecificOffset = 0.0;

		if (this.spec === Spec.SpecEnhancementShaman) {
			// Elemental Devastation uptime is near 100%
			const ranks = (this as Player<Spec.SpecEnhancementShaman>).getTalents().elementalDevastation;
			specSpecificOffset = 3.0 * ranks;
		}

		const debuffCrit = 0.0;

		this.sim.raid.getDebuffs();

		const baseCritCap = 100.0 - glancing + suppression - remainingMeleeHitCap - remainingExpertiseCap - specSpecificOffset;
		const playerCritCapDelta = meleeCrit - baseCritCap + debuffCrit;

		return {
			meleeCrit,
			meleeHit,
			expertise,
			glancing,
			suppression,
			debuffCrit,
			hasOffhandWeapon,
			meleeHitCap,
			dodgeCap,
			parryCap,
			baseCritCap,
			specSpecificOffset,
			playerCritCapDelta,
			remainingMeleeHitCap,
		};
	}

	getSimpleRotation(): SpecRotation<SpecType> {
		const jsonStr = this.aplRotation.simple?.specRotationJson || '';
		if (!jsonStr) {
			return this.specTypeFunctions.rotationCreate();
		}

		try {
			const json = JSON.parse(jsonStr);
			return this.specTypeFunctions.rotationFromJson(json);
		} catch (e) {
			console.warn(`Error parsing rotation spec options: ${e}\n\nSpec options: '${jsonStr}'`);
			return this.specTypeFunctions.rotationCreate();
		}
	}

	setSimpleRotation(eventID: EventID, newRotation: SpecRotation<SpecType>) {
		if (this.specTypeFunctions.rotationEquals(newRotation, this.getSimpleRotation())) return;

		if (!this.aplRotation.simple) {
			this.aplRotation.simple = SimpleRotation.create();
		}
		this.aplRotation.simple.specRotationJson = JSON.stringify(this.specTypeFunctions.rotationToJson(newRotation));

		this.rotationChangeEmitter.emit(eventID);
	}

	getSimpleCooldowns(): Cooldowns {
		// Make a defensive copy
		return Cooldowns.clone(this.aplRotation.simple?.cooldowns || Cooldowns.create());
	}

	setSimpleCooldowns(eventID: EventID, newCooldowns: Cooldowns) {
		if (Cooldowns.equals(this.getSimpleCooldowns(), newCooldowns)) return;

		if (!this.aplRotation.simple) {
			this.aplRotation.simple = SimpleRotation.create();
		}
		this.aplRotation.simple.cooldowns = newCooldowns;
		this.rotationChangeEmitter.emit(eventID);
	}

	setAplRotation(eventID: EventID, newRotation: APLRotation) {
		if (APLRotation.equals(newRotation, this.aplRotation)) return;

		this.aplRotation = APLRotation.clone(newRotation);
		this.rotationChangeEmitter.emit(eventID);
	}

	getRotationType(): APLRotationType {
		if (this.aplRotation.type === APLRotationType.TypeUnknown) {
			return APLRotationType.TypeAPL;
		} else {
			return this.aplRotation.type;
		}
	}

	hasSimpleRotationGenerator(): boolean {
		return this.simpleRotationGenerator !== null;
	}

	getResolvedAplRotation(): APLRotation {
		const type = this.getRotationType();
		if (type === APLRotationType.TypeAuto && this.autoRotationGenerator) {
			// Clone to avoid modifying preset rotations, which are often returned directly.
			const rot = APLRotation.clone(this.autoRotationGenerator(this));
			rot.type = APLRotationType.TypeAuto;
			return rot;
		} else if (type === APLRotationType.TypeSimple && this.simpleRotationGenerator) {
			// Clone to avoid modifying preset rotations, which are often returned directly.
			const simpleRot = this.getSimpleRotation();
			const rot = APLRotation.clone(this.simpleRotationGenerator(this, simpleRot, this.getSimpleCooldowns()));
			rot.simple = this.aplRotation.simple;
			rot.type = APLRotationType.TypeSimple;
			return rot;
		} else {
			return this.aplRotation;
		}
	}

	getTalents(): SpecTalents<SpecType> {
		if (this.talents === null) {
			this.talents = playerTalentStringToProto(this.spec, this.talentsString) as SpecTalents<SpecType>;
		}
		return this.talents!;
	}

	getTalentsString(): string {
		return this.talentsString;
	}

	setTalentsString(eventID: EventID, newTalentsString: string) {
		if (newTalentsString === this.talentsString) return;

		this.talentsString = newTalentsString;
		this.talents = null;
		this.talentsChangeEmitter.emit(eventID);
	}

	getTalentTree(): number {
		return getTalentTree(this.getTalentsString());
	}

	getTalentTreePoints(): Array<number> {
		return getTalentTreePoints(this.getTalentsString());
	}

	getTalentTreeIcon(): string {
		return getTalentTreeIcon(this.spec, this.getTalentsString());
	}

	getSpecOptions(): SpecOptions<SpecType> {
		return this.specTypeFunctions.optionsCopy(this.specOptions);
	}

	setSpecOptions(eventID: EventID, newSpecOptions: SpecOptions<SpecType>) {
		if (this.specTypeFunctions.optionsEquals(newSpecOptions, this.specOptions)) return;

		this.specOptions = this.specTypeFunctions.optionsCopy(newSpecOptions);
		this.specOptionsChangeEmitter.emit(eventID);
	}

	getReactionTime(): number {
		return this.reactionTime;
	}

	setReactionTime(eventID: EventID, newReactionTime: number) {
		if (newReactionTime === this.reactionTime) return;

		this.reactionTime = newReactionTime;
		this.miscOptionsChangeEmitter.emit(eventID);
	}

	getChannelClipDelay(): number {
		return this.channelClipDelay;
	}

	setChannelClipDelay(eventID: EventID, newChannelClipDelay: number) {
		if (newChannelClipDelay === this.channelClipDelay) return;

		this.channelClipDelay = newChannelClipDelay;
		this.miscOptionsChangeEmitter.emit(eventID);
	}

	getInFrontOfTarget(): boolean {
		return this.inFrontOfTarget;
	}

	setInFrontOfTarget(eventID: EventID, newInFrontOfTarget: boolean) {
		if (newInFrontOfTarget === this.inFrontOfTarget) return;

		this.inFrontOfTarget = newInFrontOfTarget;
		this.inFrontOfTargetChangeEmitter.emit(eventID);
	}

	getDistanceFromTarget(): number {
		return this.distanceFromTarget;
	}

	setDistanceFromTarget(eventID: EventID, newDistanceFromTarget: number) {
		if (newDistanceFromTarget === this.distanceFromTarget) return;

		this.distanceFromTarget = newDistanceFromTarget;
		this.distanceFromTargetChangeEmitter.emit(eventID);
	}

	setDefaultHealingParams(hm: HealingModel) {
		const boss = this.sim.encounter.primaryTarget;
		const dualWield = boss.dualWield;
		if (hm.cadenceSeconds === 0) {
			hm.cadenceSeconds = 1.5 * boss.swingSpeed;
			if (dualWield) {
				hm.cadenceSeconds /= 2;
			}
		}
		if (hm.hps === 0) {
			hm.hps = (0.175 * boss.minBaseDamage) / boss.swingSpeed;
			if (dualWield) {
				hm.hps *= 1.5;
			}
		}
	}

	enableHealing() {
		this.healingEnabled = true;
		const hm = this.getHealingModel();
		if (hm.cadenceSeconds === 0 || hm.hps === 0) {
			this.setDefaultHealingParams(hm);
			this.setHealingModel(0, hm);
		}
	}

	getHealingModel(): HealingModel {
		// Make a defensive copy
		return HealingModel.clone(this.healingModel);
	}

	setHealingModel(eventID: EventID, newHealingModel: HealingModel) {
		if (HealingModel.equals(this.healingModel, newHealingModel)) return;

		// Make a defensive copy
		this.healingModel = HealingModel.clone(newHealingModel);
		// If we have enabled healing model and try to set 0s cadence or 0 incoming HPS, then set intelligent defaults instead based on boss parameters.
		if (this.healingEnabled) {
			this.setDefaultHealingParams(this.healingModel);
		}
		this.healingModelChangeEmitter.emit(eventID);
	}

	getIsbSbFrequency(): number {
		return this.isbSbFrequency;
	}

	setIsbSbFrequency(eventID: EventID, newIsbSbFrequency: number) {
		if (newIsbSbFrequency === this.isbSbFrequency) return;

		this.isbSbFrequency = newIsbSbFrequency;
		this.changeEmitter.emit(eventID);
	}

	getIsbCrit(): number {
		return this.isbCrit;
	}

	setIsbCrit(eventID: EventID, newIsbCrit: number) {
		if (newIsbCrit === this.isbCrit) return;

		this.isbCrit = newIsbCrit;
		this.changeEmitter.emit(eventID);
	}

	getIsbWarlocks(): number {
		return this.isbWarlocks;
	}

	setIsbWarlocks(eventID: EventID, newIsbWarlocks: number) {
		if (newIsbWarlocks === this.isbWarlocks) return;

		this.isbWarlocks = newIsbWarlocks;
		this.changeEmitter.emit(eventID);
	}

	getIsbSpriests(): number {
		return this.isbSpriests;
	}

	setIsbSpriests(eventID: EventID, newIsbSpriests: number) {
		if (newIsbSpriests === this.isbSpriests) return;

		this.isbSpriests = newIsbSpriests;
		this.changeEmitter.emit(eventID);
	}

	getStormstrikeFrequency(): number {
		return this.stormstrikeFrequency;
	}

	setStormstrikeFrequency(eventID: EventID, newStormstrikeFrequency: number) {
		if (newStormstrikeFrequency === this.stormstrikeFrequency) return;

		this.stormstrikeFrequency = newStormstrikeFrequency;
		this.changeEmitter.emit(eventID);
	}

	getStormstrikeNatureAttackerFrequency(): number {
		return this.stormstrikeNatureAttackerFrequency;
	}

	setStormstrikeNatureAttackerFrequency(eventID: EventID, newStormstrikeNatureAttackerFrequency: number) {
		if (newStormstrikeNatureAttackerFrequency === this.stormstrikeNatureAttackerFrequency) return;

		this.stormstrikeNatureAttackerFrequency = newStormstrikeNatureAttackerFrequency;
		this.changeEmitter.emit(eventID);
	}

	computeStatsEP(stats?: Stats): number {
		if (stats === undefined) {
			return 0;
		}
		return stats.computeEP(this.epWeights);
	}

	computeEnchantEP(enchant: Enchant): number {
		if (this.enchantEPCache.has(enchant.effectId)) {
			return this.enchantEPCache.get(enchant.effectId)!;
		}

		let ep = this.computeStatsEP(new Stats(enchant.stats));

		if (enchant.stats[Stat.StatMeleeHaste] > 0) {
			ep += this.epWeights.getPseudoStat(PseudoStat.PseudoStatMeleeSpeedMultiplier) * enchant.stats[Stat.StatMeleeHaste];
			ep += this.epWeights.getPseudoStat(PseudoStat.PseudoStatRangedSpeedMultiplier) * enchant.stats[Stat.StatMeleeHaste];
		}

		if (enchant.stats[Stat.StatSpellHaste] > 0) {
			ep += this.epWeights.getPseudoStat(PseudoStat.PseudoStatCastSpeedMultiplier) * enchant.stats[Stat.StatSpellHaste];
		}

		this.enchantEPCache.set(enchant.effectId, ep);
		return ep;
	}

	computeRandomSuffixEP(randomSuffix: ItemRandomSuffix): number {
		if (this.randomSuffixEPCache.has(randomSuffix.id)) {
			return this.randomSuffixEPCache.get(randomSuffix.id)!;
		}

		const ep = this.computeStatsEP(new Stats(randomSuffix.stats));
		this.randomSuffixEPCache.set(randomSuffix.id, ep);
		return ep;
	}

	computeItemEP(item: Item, slot: ItemSlot): number {
		if (item === null) return 0;

		const cached = this.itemEPCache[slot].get(item.id);
		if (cached !== undefined) return cached;

		let itemStats = new Stats(item.stats);
		if (item.weaponSpeed > 0) {
			const weaponDps = getWeaponDPS(item);
			if (slot === ItemSlot.ItemSlotMainHand) {
				itemStats = itemStats.withPseudoStat(PseudoStat.PseudoStatMainHandDps, weaponDps);
			} else if (slot === ItemSlot.ItemSlotOffHand) {
				itemStats = itemStats.withPseudoStat(PseudoStat.PseudoStatOffHandDps, weaponDps);
			} else if (slot === ItemSlot.ItemSlotRanged) {
				itemStats = itemStats.withPseudoStat(PseudoStat.PseudoStatRangedDps, weaponDps);
			}
		}

		// Add pseudo stats that should be included in item EP.
		itemStats = itemStats.addPseudoStat(PseudoStat.BonusPhysicalDamage, item.bonusPhysicalDamage);

		// For random suffix items, use the suffix option with the highest EP for the purposes of ranking items in the picker.
		let maxSuffixEP = 0;

		if (item.randomSuffixOptions.length > 0) {
			const suffixEPs = item.randomSuffixOptions.map(id => this.computeRandomSuffixEP(this.sim.db.getRandomSuffixById(id)!));
			maxSuffixEP = Math.max(...suffixEPs);
		}

		let ep = itemStats.computeEP(this.epWeights) + maxSuffixEP;

		// unique items are slightly worse than non-unique because you can have only one.
		if (item.unique) {
			ep -= 0.01;
		}

		if (item.stats[Stat.StatMeleeHaste] > 0) {
			ep += this.epWeights.getPseudoStat(PseudoStat.PseudoStatMeleeSpeedMultiplier) * item.stats[Stat.StatMeleeHaste];
			ep += this.epWeights.getPseudoStat(PseudoStat.PseudoStatRangedSpeedMultiplier) * item.stats[Stat.StatMeleeHaste];
		}

		if (item.stats[Stat.StatSpellHaste] > 0) {
			ep += this.epWeights.getPseudoStat(PseudoStat.PseudoStatCastSpeedMultiplier) * item.stats[Stat.StatSpellHaste];
		}

		this.itemEPCache[slot].set(item.id, ep);
		return ep;
	}

	setWowheadData(equippedItem: EquippedItem, elem: HTMLElement) {
		const parts = [];

		const lang = getLanguageCode();
		const langPrefix = lang ? lang + '.' : '';
		parts.push(`domain=${langPrefix}classic`);

		if (equippedItem.enchant !== null) {
			parts.push('ench=' + equippedItem.enchant.effectId);
		}
		parts.push(
			'pcs=' +
				this.gear
					.asArray()
					.filter(ei => ei !== null)
					.map(ei => ei!.item.id)
					.join(':'),
		);

		elem.dataset.wowhead = parts.join('&');
		elem.dataset.whtticon = 'false';
	}

	static ARMOR_SLOTS: Array<ItemSlot> = [
		ItemSlot.ItemSlotHead,
		ItemSlot.ItemSlotShoulder,
		ItemSlot.ItemSlotChest,
		ItemSlot.ItemSlotWrist,
		ItemSlot.ItemSlotHands,
		ItemSlot.ItemSlotLegs,
		ItemSlot.ItemSlotWaist,
		ItemSlot.ItemSlotFeet,
	];

	static WEAPON_SLOTS: Array<ItemSlot> = [ItemSlot.ItemSlotMainHand, ItemSlot.ItemSlotOffHand];

	filterItemData<T>(itemData: Array<T>, getItemFunc: (val: T) => Item, slot: ItemSlot): Array<T> {
		const filters = this.sim.getFilters();

		const filterItems = (itemData: Array<T>, filterFunc: (item: Item) => boolean) => {
			return itemData.filter(itemElem => filterFunc(getItemFunc(itemElem)));
		};

		if (filters.minIlvl !== 0) {
			itemData = filterItems(itemData, item => item.ilvl >= filters.minIlvl);
		}
		if (filters.maxIlvl !== 0) {
			itemData = filterItems(itemData, item => item.ilvl <= filters.maxIlvl);
		}

		if (filters.factionRestriction !== UIItem_FactionRestriction.UNSPECIFIED) {
			itemData = filterItems(
				itemData,
				item => item.factionRestriction === filters.factionRestriction || item.factionRestriction === UIItem_FactionRestriction.UNSPECIFIED,
			);
		}

		if (!filters.sources.includes(SourceFilterOption.SourceCrafting)) {
			itemData = filterItems(itemData, item => !item.sources.some(itemSrc => itemSrc.source.oneofKind === 'crafted'));
		}

		if (!filters.sources.includes(SourceFilterOption.SourceQuest)) {
			itemData = filterItems(itemData, item => !item.sources.some(itemSrc => itemSrc.source.oneofKind === 'quest'));
		}

		if (!filters.sources.includes(SourceFilterOption.SourceReputation)) {
			itemData = filterItems(itemData, item => !item.sources.some(itemSrc => itemSrc.source.oneofKind === 'rep'));
		}

		if (!filters.sources.includes(SourceFilterOption.SourceDungeon)) {
			const zoneIds: Array<number> = [];

			for (const zoneName in DungeonFilterOption) {
				const zoneId = DungeonFilterOption[zoneName];

				if (typeof zoneId === 'number' && zoneId !== 0 && !filters.raids.includes(zoneId)) {
					zoneIds.push(zoneId);
				}
			}

			itemData = filterItems(
				itemData,
				item => !item.sources.some(itemSrc => itemSrc.source.oneofKind === 'drop' && zoneIds.includes(itemSrc.source.drop.zoneId)),
			);
		}

		if (!filters.sources.includes(SourceFilterOption.SourceRaid)) {
			const zoneIds: Array<number> = [];

			for (const zoneName in RaidFilterOption) {
				const zoneId = RaidFilterOption[zoneName];

				if (typeof zoneId === 'number' && zoneId !== 0 && !filters.raids.includes(zoneId)) {
					zoneIds.push(zoneId);
				}
			}

			itemData = filterItems(
				itemData,
				item => !item.sources.some(itemSrc => itemSrc.source.oneofKind === 'drop' && zoneIds.includes(itemSrc.source.drop.zoneId)),
			);
		}

		for (const zoneName in ExcludedZones) {
			const zoneId = ExcludedZones[zoneName];

			if (typeof zoneId === 'number' && zoneId !== 0) {
				itemData = filterItems(
					itemData,
					item => !item.sources.some(itemSrc => itemSrc.source.oneofKind === 'drop' && itemSrc.source.drop.zoneId === zoneId),
				);
			}
		}

		if (!filters.sources.includes(SourceFilterOption.SourceWorldBOE)) {
			itemData = filterItems(itemData, item => item.randomSuffixOptions.length === 0);
		}

		if (Player.ARMOR_SLOTS.includes(slot)) {
			itemData = filterItems(itemData, item => filters.armorTypes.includes(item.armorType));
		} else if (Player.WEAPON_SLOTS.includes(slot)) {
			itemData = filterItems(itemData, item => {
				if (!filters.weaponTypes.includes(item.weaponType)) {
					return false;
				}
				if (!filters.oneHandedWeapons && item.handType !== HandType.HandTypeTwoHand) {
					return false;
				}
				if (!filters.twoHandedWeapons && item.handType === HandType.HandTypeTwoHand) {
					return false;
				}

				const minSpeed = slot === ItemSlot.ItemSlotMainHand ? filters.minMhWeaponSpeed : filters.minOhWeaponSpeed;
				const maxSpeed = slot === ItemSlot.ItemSlotMainHand ? filters.maxMhWeaponSpeed : filters.maxOhWeaponSpeed;
				if (minSpeed > 0 && item.weaponSpeed < minSpeed) {
					return false;
				}
				if (maxSpeed > 0 && item.weaponSpeed > maxSpeed) {
					return false;
				}

				return true;
			});
		} else if (slot === ItemSlot.ItemSlotRanged) {
			itemData = filterItems(itemData, item => {
				if (!filters.rangedWeaponTypes.includes(item.rangedWeaponType)) {
					return false;
				}

				const minSpeed = filters.minRangedWeaponSpeed;
				const maxSpeed = filters.maxRangedWeaponSpeed;
				if (minSpeed > 0 && item.weaponSpeed < minSpeed) {
					return false;
				}
				if (maxSpeed > 0 && item.weaponSpeed > maxSpeed) {
					return false;
				}

				return true;
			});
		}

		return itemData;
	}

	filterEnchantData<T>(enchantData: Array<T>, getEnchantFunc: (val: T) => Enchant, slot: ItemSlot, currentEquippedItem: EquippedItem | null): Array<T> {
		if (!currentEquippedItem) {
			return enchantData;
		}

		//const filters = this.sim.getFilters();

		return enchantData.filter(enchantElem => {
			const enchant = getEnchantFunc(enchantElem);

			if (!enchantAppliesToItem(enchant, currentEquippedItem.item)) {
				return false;
			}

			return true;
		});
	}

	makeUnitReference(): UnitReference {
		if (this.party === null) {
			return emptyUnitReference();
		} else {
			return newUnitReference(this.getRaidIndex());
		}
	}

	private toDatabase(): SimDatabase {
		const dbGear = this.getGear().toDatabase();
		const dbItemSwapGear = this.getItemSwapGear().toDatabase();
		return Database.mergeSimDatabases(dbGear, dbItemSwapGear);
	}

	toProto(forExport?: boolean, forSimming?: boolean, exportCategories?: Array<SimSettingCategories>): PlayerProto {
		const exportCategory = (cat: SimSettingCategories) => !exportCategories || exportCategories.length === 0 || exportCategories.includes(cat);

		const gear = this.getGear();
		const aplRotation = forSimming ? this.getResolvedAplRotation() : this.aplRotation;

		let player = PlayerProto.create({
			class: this.getClass(),
			database: forExport ? undefined : this.toDatabase(),
		});
		if (exportCategory(SimSettingCategories.Gear)) {
			PlayerProto.mergePartial(player, {
				equipment: gear.asSpec(),
				bonusStats: this.getBonusStats().toProto(),
				enableItemSwap: this.getEnableItemSwap(),
				itemSwap: this.getItemSwapGear().toProto(),
			});
		}
		if (exportCategory(SimSettingCategories.Talents)) {
			PlayerProto.mergePartial(player, {
				talentsString: this.getTalentsString(),
			});
		}
		if (exportCategory(SimSettingCategories.Rotation)) {
			PlayerProto.mergePartial(player, {
				cooldowns: Cooldowns.create({ hpPercentForDefensives: this.getSimpleCooldowns().hpPercentForDefensives }),
				rotation: aplRotation,
			});
		}
		if (exportCategory(SimSettingCategories.Consumes)) {
			PlayerProto.mergePartial(player, {
				consumes: this.getConsumes(),
			});
		}
		if (exportCategory(SimSettingCategories.Miscellaneous)) {
			PlayerProto.mergePartial(player, {
				name: this.getName(),
				race: this.getRace(),
				profession1: this.getProfession1(),
				profession2: this.getProfession2(),
				reactionTimeMs: this.getReactionTime(),
				channelClipDelayMs: this.getChannelClipDelay(),
				inFrontOfTarget: this.getInFrontOfTarget(),
				distanceFromTarget: this.getDistanceFromTarget(),
				healingModel: this.getHealingModel(),
				isbSbFrequency: this.getIsbSbFrequency(),
				isbCrit: this.getIsbCrit(),
				isbWarlocks: this.getIsbWarlocks(),
				isbSpriests: this.getIsbSpriests(),
				stormstrikeFrequency: this.getStormstrikeFrequency(),
				stormstrikeNatureAttackerFrequency: this.getStormstrikeNatureAttackerFrequency(),
			});
			player = withSpecProto(this.spec, player, this.getSpecOptions());
		}
		if (exportCategory(SimSettingCategories.External)) {
			PlayerProto.mergePartial(player, {
				buffs: this.getBuffs(),
			});
		}
		return player;
	}

	fromProto(eventID: EventID, proto: PlayerProto, includeCategories?: Array<SimSettingCategories>) {
		const loadCategory = (cat: SimSettingCategories) => !includeCategories || includeCategories.length === 0 || includeCategories.includes(cat);

		// For backwards compatibility with legacy rotations (removed on 2024/01/15).
		if (proto.rotation?.type === APLRotationType.TypeLegacy) {
			proto.rotation.type = APLRotationType.TypeAuto;
		}

		TypedEvent.freezeAllAndDo(() => {
			if (loadCategory(SimSettingCategories.Gear)) {
				this.setGear(eventID, proto.equipment ? this.sim.db.lookupEquipmentSpec(proto.equipment) : new Gear({}));
				this.setEnableItemSwap(eventID, proto.enableItemSwap);
				this.setItemSwapGear(eventID, proto.itemSwap ? this.sim.db.lookupItemSwap(proto.itemSwap) : new ItemSwapGear({}));
				this.setBonusStats(eventID, Stats.fromProto(proto.bonusStats || UnitStats.create()));
				//this.setBulkEquipmentSpec(eventID, BulkEquipmentSpec.create()); // Do not persist the bulk equipment settings.
			}
			if (loadCategory(SimSettingCategories.Talents)) {
				this.setTalentsString(eventID, proto.talentsString);
			}
			if (loadCategory(SimSettingCategories.Rotation)) {
				if (proto.rotation?.type === APLRotationType.TypeUnknown || proto.rotation?.type === APLRotationType.TypeLegacy) {
					if (!proto.rotation) {
						proto.rotation = APLRotation.create();
					}
					proto.rotation.type = APLRotationType.TypeAuto;
				}
				this.setAplRotation(eventID, proto.rotation || APLRotation.create());
			}
			if (loadCategory(SimSettingCategories.Consumes)) {
				this.setConsumes(eventID, proto.consumes || Consumes.create());
			}
			if (loadCategory(SimSettingCategories.Miscellaneous)) {
				this.setSpecOptions(eventID, this.specTypeFunctions.optionsFromPlayer(proto));
				this.setName(eventID, proto.name);
				this.setRace(eventID, proto.race);
				this.setProfession1(eventID, proto.profession1);
				this.setProfession2(eventID, proto.profession2);
				this.setReactionTime(eventID, proto.reactionTimeMs);
				this.setChannelClipDelay(eventID, proto.channelClipDelayMs);
				this.setInFrontOfTarget(eventID, proto.inFrontOfTarget);
				this.setDistanceFromTarget(eventID, proto.distanceFromTarget);
				this.setHealingModel(eventID, proto.healingModel || HealingModel.create());
				this.setIsbSbFrequency(eventID, proto.isbSbFrequency);
				this.setIsbCrit(eventID, proto.isbCrit);
				this.setIsbWarlocks(eventID, proto.isbWarlocks);
				this.setIsbSpriests(eventID, proto.isbSpriests);
				this.setStormstrikeFrequency(eventID, proto.stormstrikeFrequency);
				this.setStormstrikeNatureAttackerFrequency(eventID, proto.stormstrikeNatureAttackerFrequency);
			}
			if (loadCategory(SimSettingCategories.External)) {
				this.setBuffs(eventID, proto.buffs || IndividualBuffs.create());
			}
		});
	}

	clone(eventID: EventID): Player<SpecType> {
		const newPlayer = new Player<SpecType>(this.spec, this.sim);
		newPlayer.fromProto(eventID, this.toProto());
		return newPlayer;
	}

	applySharedDefaults(eventID: EventID) {
		TypedEvent.freezeAllAndDo(() => {
			this.setEnableItemSwap(eventID, false);
			this.setItemSwapGear(eventID, new ItemSwapGear({}));
			this.setReactionTime(eventID, 200);
			this.setInFrontOfTarget(eventID, isTankSpec(this.spec));
			this.setHealingModel(
				eventID,
				HealingModel.create({
					burstWindow: isTankSpec(this.spec) ? 6 : 0,
				}),
			);
			this.setSimpleCooldowns(
				eventID,
				Cooldowns.create({
					hpPercentForDefensives: isTankSpec(this.spec) ? 0.35 : 0,
				}),
			);
			this.setBonusStats(eventID, new Stats());
			this.setAplRotation(
				eventID,
				APLRotation.create({
					type: APLRotationType.TypeAuto,
				}),
			);
		});
	}
}
