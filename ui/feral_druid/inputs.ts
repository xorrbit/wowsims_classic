import * as InputHelpers from '../core/components/input_helpers.js';
import { Spec } from '../core/proto/common.js';

// Configuration for spec-specific UI elements on the settings tab.
// These don't need to be in a separate file but it keeps things cleaner.

export const LatencyMs = InputHelpers.makeSpecOptionsNumberInput<Spec.SpecFeralDruid>({
	fieldName: 'latencyMs',
	label: 'Latency',
	labelTooltip: 'Player latency, in milliseconds. Adds a delay to actions that cannot be spell queued.',
});

export const FeralDruidRotationConfig = {
	inputs: [
		InputHelpers.makeRotationNumberInput<Spec.SpecFeralDruid>({
			fieldName: 'minCombosForRip',
			label: 'Min Rip CP',
			labelTooltip: 'Combo Point threshold for allowing a Rip cast',
			float: false,
			positive: true,
		}),
		InputHelpers.makeRotationNumberInput<Spec.SpecFeralDruid>({
			fieldName: 'maxWaitTime',
			label: 'Max Wait Time',
			labelTooltip: 'Max seconds to wait for an Energy tick to cast rather than powershifting',
			float: true,
			positive: true,
		}),
		InputHelpers.makeRotationBooleanInput<Spec.SpecFeralDruid>({
			fieldName: 'maintainFaerieFire',
			label: 'Maintain Faerie Fire',
			labelTooltip: 'If checked, bundle Faerie Fire refreshes with powershifts. Ignored if an external Faerie Fire debuff is selected in settings.',
		}),
		InputHelpers.makeRotationBooleanInput<Spec.SpecFeralDruid>({
			fieldName: 'precastTigersFury',
			label: `Pre-cast Tiger's Fury`,
			labelTooltip: `If checked, model a pre-pull Tiger's Fury cast 3 seconds before initiating combat.`,
		}),
		InputHelpers.makeRotationBooleanInput<Spec.SpecFeralDruid>({
			fieldName: 'useShredTrick',
			label: `Use Shred Trick`,
			labelTooltip: `If checked, enable the "Shred trick" micro-optimization. This should only be used on short fight lengths with full powershifting uptime.`,
		}),
	],
};
