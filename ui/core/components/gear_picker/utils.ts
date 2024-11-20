import { ItemSlot } from '../../proto/common';

const emptySlotIcons: Record<ItemSlot, string> = {
	[ItemSlot.ItemSlotHead]: '/classic/assets/item_slots/head.jpg',
	[ItemSlot.ItemSlotNeck]: '/classic/assets/item_slots/neck.jpg',
	[ItemSlot.ItemSlotShoulder]: '/classic/assets/item_slots/shoulders.jpg',
	[ItemSlot.ItemSlotBack]: '/classic/assets/item_slots/shirt.jpg',
	[ItemSlot.ItemSlotChest]: '/classic/assets/item_slots/chest.jpg',
	[ItemSlot.ItemSlotWrist]: '/classic/assets/item_slots/wrists.jpg',
	[ItemSlot.ItemSlotHands]: '/classic/assets/item_slots/hands.jpg',
	[ItemSlot.ItemSlotWaist]: '/classic/assets/item_slots/waist.jpg',
	[ItemSlot.ItemSlotLegs]: '/classic/assets/item_slots/legs.jpg',
	[ItemSlot.ItemSlotFeet]: '/classic/assets/item_slots/feet.jpg',
	[ItemSlot.ItemSlotFinger1]: '/classic/assets/item_slots/finger.jpg',
	[ItemSlot.ItemSlotFinger2]: '/classic/assets/item_slots/finger.jpg',
	[ItemSlot.ItemSlotTrinket1]: '/classic/assets/item_slots/trinket.jpg',
	[ItemSlot.ItemSlotTrinket2]: '/classic/assets/item_slots/trinket.jpg',
	[ItemSlot.ItemSlotMainHand]: '/classic/assets/item_slots/mainhand.jpg',
	[ItemSlot.ItemSlotOffHand]: '/classic/assets/item_slots/offhand.jpg',
	[ItemSlot.ItemSlotRanged]: '/classic/assets/item_slots/ranged.jpg',
};
export function getEmptySlotIconUrl(slot: ItemSlot): string {
	return emptySlotIcons[slot];
}
