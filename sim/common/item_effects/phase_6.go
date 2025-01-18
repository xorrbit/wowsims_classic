package item_effects

import (
	"time"

	"github.com/wowsims/classic/sim/core"
	"github.com/wowsims/classic/sim/core/proto"
	"github.com/wowsims/classic/sim/core/stats"
)

const (
	TheRestrainedEssenceOfSapphiron = 23046
	MarkOfTheChampionPhys           = 23206
	MarkOfTheChampionSpell          = 23207
)

func init() {
	core.AddEffectsToTest = false

	// https://wowhead.com/classic/item=23206?level=60&rand=0
	// Equip: +150 Attack Power when fighting Undead and Demons.
	core.NewItemEffect(MarkOfTheChampionPhys, func(agent core.Agent) {
		character := agent.GetCharacter()
		if character.CurrentTarget.MobType == proto.MobType_MobTypeUndead || character.CurrentTarget.MobType == proto.MobType_MobTypeDemon {
			character.PseudoStats.MobTypeAttackPower += 150
		}
	})

	// https://www.wowhead.com/classic/item=23207/mark-of-the-champion
	// Equip: Increases damage done to Undead and Demons by magical spells and effects by up to 85.
	core.NewItemEffect(MarkOfTheChampionSpell, func(agent core.Agent) {
		character := agent.GetCharacter()

		if character.CurrentTarget.MobType == proto.MobType_MobTypeUndead || character.CurrentTarget.MobType == proto.MobType_MobTypeDemon {
			character.PseudoStats.MobTypeSpellPower += 85
		}
	})

	// https://www.wowhead.com/classic/item=23046/the-restrained-essence-of-sapphiron
	// Use: Increases damage and healing done by magical spells and effects by up to 130 for 20 sec. (2 Min Cooldown)
	core.NewSimpleStatOffensiveTrinketEffect(TheRestrainedEssenceOfSapphiron, stats.Stats{stats.SpellPower: 130}, time.Second*20, time.Minute*2)

	core.AddEffectsToTest = true
}
