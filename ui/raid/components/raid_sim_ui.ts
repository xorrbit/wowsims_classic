import { default as pako } from 'pako';

import { EmbeddedDetailedResults } from '../../core/components/detailed_results.jsx';
import { addRaidSimAction, RaidSimResultsManager, ReferenceData } from '../../core/components/raid_sim_action.jsx';
import { raidSimStatus } from '../../core/launched_sims.js';
import { Player } from '../../core/player.js';
import { Raid as RaidProto } from '../../core/proto/api.js';
import { Class, Encounter as EncounterProto, TristateEffect } from '../../core/proto/common.js';
import { Blessings } from '../../core/proto/paladin.js';
import { BlessingsAssignments, RaidSimSettings } from '../../core/proto/ui.js';
import { playerToSpec } from '../../core/proto_utils/utils.js';
import { Sim } from '../../core/sim.js';
import { SimUI } from '../../core/sim_ui.jsx';
import { EventID, TypedEvent } from '../../core/typed_event.js';
import { implementedSpecs } from '../presets.js';
import { BlessingsPicker } from './blessings_picker.js';
import { RaidJsonExporter } from './exporters';
import { RaidJsonImporter, RaidWCLImporter } from './importers';
import { RaidPicker } from './raid_picker.jsx';
import { RaidTab } from './raid_tab.js';
import { SettingsTab } from './settings_tab.js';

export interface RaidSimConfig {
	knownIssues?: Array<string>;
}

const extraKnownIssues: Array<string> = [
	//'We\'re still missing implementations for many specs. If you\'d like to help us out, check out our <a href="https://github.com/wowsims/classic">Github project</a> or <a href="https://discord.gg/jJMPr9JWwx">join our discord</a>!',
];

export class RaidSimUI extends SimUI {
	private readonly config: RaidSimConfig;
	private raidSimResultsManager: RaidSimResultsManager | null = null;
	public raidPicker: RaidPicker | null = null;
	public blessingsPicker: BlessingsPicker | null = null;

	// Emits when the raid comp changes. Includes changes to buff bots.
	readonly compChangeEmitter = new TypedEvent<void>();
	readonly changeEmitter = new TypedEvent<void>();

	readonly referenceChangeEmitter = new TypedEvent<void>();

	constructor(parentElem: HTMLElement, config: RaidSimConfig) {
		super(parentElem, new Sim(), {
			cssClass: 'raid-sim-ui',
			cssScheme: 'raid',
			spec: null,
			simStatus: raidSimStatus,
			knownIssues: (config.knownIssues || []).concat(extraKnownIssues),
		});

		this.config = config;

		this.sim.raid.compChangeEmitter.on(eventID => this.compChangeEmitter.emit(eventID));
		[this.compChangeEmitter, this.sim.changeEmitter].forEach(emitter => emitter.on(eventID => this.changeEmitter.emit(eventID)));
		this.changeEmitter.on(() => this.recomputeSettingsLayout());

		this.sim.setModifyRaidProto(raidProto => this.modifyRaidProto(raidProto));
		this.sim.waitForInit().then(() => this.loadSettings());

		this.addSidebarComponents();
		this.addTopbarComponents();
		this.addRaidTab();
		this.addSettingsTab();
		this.addDetailedResultsTab();
	}

	private loadSettings() {
		const initEventID = TypedEvent.nextEventID();
		TypedEvent.freezeAllAndDo(() => {
			let loadedSettings = false;

			const savedSettings = window.localStorage.getItem(this.getSettingsStorageKey());
			if (savedSettings != null) {
				try {
					const settings = RaidSimSettings.fromJsonString(savedSettings);
					this.fromProto(initEventID, settings);
					loadedSettings = true;
				} catch (e) {
					console.warn('Failed to parse saved settings: ' + e);
				}
			}

			if (!loadedSettings) {
				this.applyDefaults(initEventID);
			}

			// This needs to go last so it doesn't re-store things as they are initialized.
			this.changeEmitter.on(eventID => {
				const jsonStr = RaidSimSettings.toJsonString(this.toProto());
				window.localStorage.setItem(this.getSettingsStorageKey(), jsonStr);
			});
		});
	}

	private addSidebarComponents() {
		this.raidSimResultsManager = addRaidSimAction(this);
		this.raidSimResultsManager.changeEmitter.on(eventID => this.referenceChangeEmitter.emit(eventID));
	}

	private addTopbarComponents() {
		this.simHeader.addImportLink('JSON', new RaidJsonImporter(this.rootElem, this));
		this.simHeader.addImportLink('WCL', new RaidWCLImporter(this.rootElem, this));

		this.simHeader.addExportLink('JSON', new RaidJsonExporter(this.rootElem, this));
	}

	private addRaidTab() {
		new RaidTab(this.simTabContentsContainer, this);
	}

	private addSettingsTab() {
		new SettingsTab(this.simTabContentsContainer, this);
	}

	private addDetailedResultsTab() {
		this.addTab(
			'Results',
			'detailed-results-tab',
			`
			<div class="detailed-results">
			</div>
		`,
		);

		const detailedResults = new EmbeddedDetailedResults(
			this.rootElem.getElementsByClassName('detailed-results')[0] as HTMLElement,
			this,
			this.raidSimResultsManager!,
		);
	}

	private recomputeSettingsLayout() {
		window.dispatchEvent(new Event('resize'));
	}

	private modifyRaidProto(raidProto: RaidProto) {
		// Apply blessings.
		const numPaladins = this.getClassCount(Class.ClassPaladin);
		const blessingsAssignments = this.blessingsPicker!.getAssignments();
		implementedSpecs.forEach(spec => {
			const playerProtos = raidProto.parties
				.map(party => party.players.filter(player => player.class != Class.ClassUnknown && playerToSpec(player) == spec))
				.flat();

			blessingsAssignments.paladins.forEach((paladin, i) => {
				if (i >= numPaladins) {
					return;
				}

				if (paladin.blessings[spec] == Blessings.BlessingOfKings) {
					playerProtos.forEach(playerProto => (playerProto.buffs!.blessingOfKings = true));
				} else if (paladin.blessings[spec] == Blessings.BlessingOfMight) {
					playerProtos.forEach(playerProto => (playerProto.buffs!.blessingOfMight = TristateEffect.TristateEffectImproved));
				} else if (paladin.blessings[spec] == Blessings.BlessingOfWisdom) {
					playerProtos.forEach(playerProto => (playerProto.buffs!.blessingOfWisdom = TristateEffect.TristateEffectImproved));
				} else if (paladin.blessings[spec] == Blessings.BlessingOfSanctuary) {
					playerProtos.forEach(playerProto => (playerProto.buffs!.blessingOfSanctuary = true));
				}
			});
		});
	}

	getCurrentData(): ReferenceData | null {
		if (this.raidSimResultsManager) {
			return this.raidSimResultsManager.getCurrentData();
		} else {
			return null;
		}
	}

	getReferenceData(): ReferenceData | null {
		if (this.raidSimResultsManager) {
			return this.raidSimResultsManager.getReferenceData();
		} else {
			return null;
		}
	}

	getActivePlayers(): Array<Player<any>> {
		return this.sim.raid.getActivePlayers();
	}

	getClassCount(playerClass: Class): number {
		return this.getActivePlayers().filter(player => player.isClass(playerClass)).length;
	}

	applyDefaults(eventID: EventID) {
		TypedEvent.freezeAllAndDo(() => {
			this.sim.raid.fromProto(
				eventID,
				RaidProto.create({
					numActiveParties: 5,
				}),
			);
			this.sim.setPhase(eventID, 1);
			this.sim.encounter.applyDefaults(eventID);
			this.sim.applyDefaults(eventID, true, true);
			this.sim.setShowDamageMetrics(eventID, true);
		});
	}

	toProto(): RaidSimSettings {
		return RaidSimSettings.create({
			settings: this.sim.toProto(),
			raid: this.sim.raid.toProto(true),
			blessings: this.blessingsPicker!.getAssignments(),
			encounter: this.sim.encounter.toProto(),
		});
	}

	toLink(): string {
		const proto = this.toProto();
		// When sharing links, people generally don't intend to share settings.
		proto.settings = undefined;

		const protoBytes = RaidSimSettings.toBinary(proto);
		// @ts-ignore Pako did some weird stuff between versions and the @types package doesn't correctly support this syntax for version 2.0.4 but it's completely valid
		// The syntax was removed in 2.1.0 and there were several complaints but the project seems to be largely abandoned now
		const deflated = pako.deflate(protoBytes, { to: 'string' });
		const encoded = btoa(String.fromCharCode(...deflated));

		const linkUrl = new URL(window.location.href);
		linkUrl.hash = encoded;
		return linkUrl.toString();
	}

	fromProto(eventID: EventID, settings: RaidSimSettings) {
		TypedEvent.freezeAllAndDo(() => {
			if (settings.settings) {
				this.sim.fromProto(eventID, settings.settings);
			}
			this.sim.raid.fromProto(eventID, settings.raid || RaidProto.create());
			this.sim.encounter.fromProto(eventID, settings.encounter || EncounterProto.create());
			this.blessingsPicker!.setAssignments(eventID, settings.blessings || BlessingsAssignments.create());
		});
	}

	clearRaid(eventID: EventID) {
		this.sim.raid.clear(eventID);
	}

	// Returns the actual key to use for local storage, based on the given key part and the site context.
	getStorageKey(keyPart: string): string {
		return '__classic_raid__' + keyPart;
	}

	getSavedRaidStorageKey(): string {
		return this.getStorageKey('__savedRaid__');
	}
}
