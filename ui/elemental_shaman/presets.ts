import { Phase } from '../core/constants/other.js';
import * as PresetUtils from '../core/preset_utils.js';
import {
	AttackPowerBuff,
	Conjured,
	Consumes,
	Debuffs,
	FirePowerBuff,
	Flask,
	Food,
	IndividualBuffs,
	ManaRegenElixir,
	Potions,
	Profession,
	RaidBuffs,
	SaygesFortune,
	SpellPowerBuff,
	StrengthBuff,
	TristateEffect,
	WeaponImbue,
	ZanzaBuff,
} from '../core/proto/common.js';
import { ElementalShaman_Options as ElementalShamanOptions } from '../core/proto/shaman.js';
import { SavedTalents } from '../core/proto/ui.js';
import Phase1APLJSON from './apls/phase_1.apl.json';
import Phase1GearJSON from './gear_sets/phase_1.gear.json';
import Phase2GearJSON from './gear_sets/phase_2.gear.json';
import Phase3GearJSON from './gear_sets/phase_3.gear.json';

// Preset options for this spec.
// Eventually we will import these values for the raid sim too, so its good to
// keep them in a separate file.

///////////////////////////////////////////////////////////////////////////
//                                 Gear Presets
///////////////////////////////////////////////////////////////////////////

export const GearPhase1 = PresetUtils.makePresetGear('Phase 1', Phase1GearJSON);
export const GearPhase2 = PresetUtils.makePresetGear('Phase 2', Phase2GearJSON);
export const GearPhase3 = PresetUtils.makePresetGear('Phase 3', Phase3GearJSON);

export const GearPresets = {
	[Phase.Phase1]: [GearPhase1],
	[Phase.Phase2]: [GearPhase2],
	[Phase.Phase3]: [GearPhase3],
	[Phase.Phase4]: [],
	[Phase.Phase5]: [],
};

export const DefaultGear = GearPresets[Phase.Phase2][0];

///////////////////////////////////////////////////////////////////////////
//                                 APL Presets
///////////////////////////////////////////////////////////////////////////

export const APLPhase1 = PresetUtils.makePresetAPLRotation('Phase 1', Phase1APLJSON);

export const APLPresets = {
	[Phase.Phase1]: [APLPhase1],
	[Phase.Phase2]: [],
	[Phase.Phase3]: [],
	[Phase.Phase4]: [],
	[Phase.Phase5]: [],
};

export const DefaultAPL = APLPresets[Phase.Phase1][0];

///////////////////////////////////////////////////////////////////////////
//                                 Talent Presets
///////////////////////////////////////////////////////////////////////////

export const TalentsLevel60 = PresetUtils.makePresetTalents('Level 60', SavedTalents.create({ talentsString: '550331050002151--50105301005' }));

export const TalentPresets = {
	[Phase.Phase1]: [TalentsLevel60],
	[Phase.Phase2]: [],
	[Phase.Phase3]: [],
	[Phase.Phase4]: [],
	[Phase.Phase5]: [],
};

export const DefaultTalents = TalentPresets[Phase.Phase1][0];

///////////////////////////////////////////////////////////////////////////
//                                 Options
///////////////////////////////////////////////////////////////////////////

export const DefaultOptions = ElementalShamanOptions.create({});

export const DefaultConsumes = Consumes.create({
	attackPowerBuff: AttackPowerBuff.JujuMight,
	defaultConjured: Conjured.ConjuredDemonicRune,
	defaultPotion: Potions.MajorManaPotion,
	firePowerBuff: FirePowerBuff.ElixirOfGreaterFirepower,
	flask: Flask.FlaskOfSupremePower,
	food: Food.FoodRunnTumTuberSurprise,
	mainHandImbue: WeaponImbue.LesserWizardOil,
	manaRegenElixir: ManaRegenElixir.MagebloodPotion,
	spellPowerBuff: SpellPowerBuff.GreaterArcaneElixir,
	strengthBuff: StrengthBuff.JujuPower,
	zanzaBuff: ZanzaBuff.CerebralCortexCompound,
});

export const DefaultRaidBuffs = RaidBuffs.create({
	arcaneBrilliance: true,
	divineSpirit: true,
	giftOfTheWild: TristateEffect.TristateEffectImproved,
	manaSpringTotem: TristateEffect.TristateEffectRegular,
	moonkinAura: true,
	strengthOfEarthTotem: TristateEffect.TristateEffectImproved,
});

export const DefaultIndividualBuffs = IndividualBuffs.create({
	fengusFerocity: true,
	rallyingCryOfTheDragonslayer: true,
	saygesFortune: SaygesFortune.SaygesDamage,
	slipkiksSavvy: true,
	songflowerSerenade: true,
	spiritOfZandalar: true,
	warchiefsBlessing: true,
});

export const DefaultDebuffs = Debuffs.create({
	curseOfRecklessness: true,
	faerieFire: true,
	improvedScorch: true,
	stormstrike: true,
	sunderArmor: true,
});

export const OtherDefaults = {
	distanceFromTarget: 15,
	profession2: Profession.Alchemy,
	profession1: Profession.Enchanting,
};
