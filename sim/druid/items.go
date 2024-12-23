package druid

import (
	"slices"

	"github.com/wowsims/classic/sim/core"
)

// Totem Item IDs
const (
	WolfsheadHelm   = 8345
	IdolOfFerocity  = 22397
	IdolOfTheMoon   = 23197
	IdolOfBrutality = 23198
)

func init() {
	core.AddEffectsToTest = false

	// https://www.wowhead.com/classic/item=22397/idol-of-ferocity
	// Equip: Reduces the energy cost of Claw and Rake by 3.
	core.NewItemEffect(IdolOfFerocity, func(agent core.Agent) {
		druid := agent.(DruidAgent).GetDruid()

		// TODO: Claw is not implemented
		druid.OnSpellRegistered(func(spell *core.Spell) {
			if spell.SpellCode == SpellCode_DruidRake {
				spell.Cost.FlatModifier -= 3
			}
		})
	})

	// https://www.wowhead.com/classic/item=23197/idol-of-the-moon
	// Equip: Increases the damage of your Moonfire spell by up to 33.
	core.NewItemEffect(IdolOfTheMoon, func(agent core.Agent) {
		druid := agent.(DruidAgent).GetDruid()
		druid.OnSpellRegistered(func(spell *core.Spell) {
			if spell.SpellCode == SpellCode_DruidMoonfire {
				spell.BonusDamage += 33
			}
		})
	})

	// https://www.wowhead.com/classic/item=23198/idol-of-brutality
	// Equip: Reduces the rage cost of Maul and Swipe by 3.
	core.NewItemEffect(IdolOfBrutality, func(agent core.Agent) {
		// Implemented in maul.go and swipe.go
	})

	core.AddEffectsToTest = true
}
