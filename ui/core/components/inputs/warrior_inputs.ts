import * as InputHelpers from '../../components/input_helpers';
import { WarriorShout, WarriorStance } from '../../proto/warrior';
import { ActionId } from '../../proto_utils/action_id';
import { WarriorSpecs } from '../../proto_utils/utils';
import { TypedEvent } from '../../typed_event';

export const StartingRage = <SpecType extends WarriorSpecs>() =>
	InputHelpers.makeSpecOptionsNumberInput<SpecType>({
		fieldName: 'startingRage',
		label: 'Starting Rage',
		labelTooltip: 'Initial rage at the start of each iteration.',
	});

export const StanceSnapshot = <SpecType extends WarriorSpecs>() =>
	InputHelpers.makeSpecOptionsBooleanInput<SpecType>({
		fieldName: 'stanceSnapshot',
		label: 'Stance Snapshot',
		labelTooltip: 'Ability that is cast at the same time as stance swap will benefit from the bonus of the stance before the swap.',
	});

export const QueueDelay = <SpecType extends WarriorSpecs>() =>
	InputHelpers.makeSpecOptionsNumberInput<SpecType>({
		fieldName: 'queueDelay',
		label: 'HS/Cleave Queue Delay (ms)',
		labelTooltip: 'How long (in milliseconds) to delay re-queueing Heroic Strike/Cleave in order to simulate real reaction time and game delay.',
	});

export const ShoutPicker = <SpecType extends WarriorSpecs>() =>
	InputHelpers.makeSpecOptionsBooleanIconInput<SpecType>({
		fieldName: 'shout',
		actionId: () => ActionId.fromSpellId(6673),
		value: WarriorShout.WarriorShoutBattle,
	});

export const StancePicker = <SpecType extends WarriorSpecs>() =>
	InputHelpers.makeSpecOptionsEnumIconInput<SpecType, WarriorStance>({
		fieldName: 'stance',
		values: [
			{ value: WarriorStance.WarriorStanceNone },
			{ value: WarriorStance.WarriorStanceBattle, actionId: () => ActionId.fromSpellId(2457) },
			{ value: WarriorStance.WarriorStanceDefensive, actionId: () => ActionId.fromSpellId(71) },
			{ value: WarriorStance.WarriorStanceBerserker, actionId: () => ActionId.fromSpellId(2458) },
		],
		changeEmitter: player => TypedEvent.onAny([player.specOptionsChangeEmitter, player.gearChangeEmitter]),
		tooltip: 'Starting Stance<br />If blank, automatically chooses a stance based on your talents and runes.',
	});
