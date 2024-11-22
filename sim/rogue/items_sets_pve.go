package rogue

import (
	"time"

	"github.com/wowsims/classic/sim/core"
	//"github.com/wowsims/classic/sim/core/proto"
	"github.com/wowsims/classic/sim/core/stats"
)

///////////////////////////////////////////////////////////////////////////
//                            Phase 1 Item Sets - Molten Core
///////////////////////////////////////////////////////////////////////////

var ItemSetNightslayerArmor = core.NewItemSet(core.ItemSet{
	Name: "Nightslayer Armor",
	Bonuses: map[int32]core.ApplyEffect{
		// Reduces the cooldown of your Vanish ability by 30 sec.
		3: func(agent core.Agent) {
			c := agent.(RogueAgent).GetRogue()
			c.RegisterAura(core.Aura{
				Label: "Improved Vanish",
				OnInit: func(aura *core.Aura, sim *core.Simulation) {
					c.Vanish.CD.Duration -= time.Second * 30
				},
			})
		},
		// Increases your maximum Energy by 10.
		5: func(agent core.Agent) {
			c := agent.GetCharacter()
			if c.HasEnergyBar() {
				c.EnableEnergyBar(c.MaxEnergy() + 10)
			}
		},
		// Heals the rogue for 500 when Vanish is performed.
		8: func(agent core.Agent) {
			c := agent.GetCharacter()
			healthMetrics := c.NewHealthMetrics(core.ActionID{SpellID: 23582})
			
			core.MakePermanent(c.RegisterAura(core.Aura{
				Label:     "Clean Escape",
				OnCastComplete: func(aura *core.Aura, sim *core.Simulation, spell *core.Spell)  {
					if spell.SpellCode == SpellCode_RogueVanish {
						c.GainHealth(sim, 500, healthMetrics)
					}
				},
			}))
		},
	},
})


///////////////////////////////////////////////////////////////////////////
//                            Phase 2 Item Sets - Dire Maul
///////////////////////////////////////////////////////////////////////////

///////////////////////////////////////////////////////////////////////////
//                            Phase 3 Item Sets - BWL
///////////////////////////////////////////////////////////////////////////

var ItemSetBloodfangArmor = core.NewItemSet(core.ItemSet{
	Name: "Bloodfang Armor",
	Bonuses: map[int32]core.ApplyEffect{
		// Increases the chance to apply poisons to your target by 5%.
		3: func(agent core.Agent) {
			c := agent.(RogueAgent).GetRogue()
			c.RegisterAura(core.Aura{
				Label: "Improved Vanish",
				OnInit: func(aura *core.Aura, sim *core.Simulation) {
					c.Vanish.CD.Duration -= time.Second * 30
				},
			})
		},
		// Improves the threat reduction of Feint by 25%.
		5: func(agent core.Agent) {
			c := agent.GetCharacter()
			if c.HasEnergyBar() {
				c.EnableEnergyBar(c.MaxEnergy() + 10)
			}
		},
		// Gives the Rogue a chance to inflict 283 to 317 damage on the target and heal the Rogue for 50 health every 1 sec. for 6 sec. on a melee hit.
		8: func(agent core.Agent) {
			c := agent.GetCharacter()
			healthMetrics := c.NewHealthMetrics(core.ActionID{SpellID: 23582})
			
			core.MakePermanent(c.RegisterAura(core.Aura{
				Label:     "Clean Escape",
				OnCastComplete: func(aura *core.Aura, sim *core.Simulation, spell *core.Spell)  {
					if spell.SpellCode == SpellCode_RogueVanish {
						c.GainHealth(sim, 500, healthMetrics)
					}
				},
			}))
		},
	},
})

///////////////////////////////////////////////////////////////////////////
//                            Phase 4 Item Sets - AQ
///////////////////////////////////////////////////////////////////////////

// https://www.wowhead.com/classic/item-set=512/darkmantle-armor
var ItemSetDarkmantleArmor = core.NewItemSet(core.ItemSet{
	Name: "Darkmantle Armor",
	Bonuses: map[int32]core.ApplyEffect{
		// +40 Attack Power.
		2: func(agent core.Agent) {
			c := agent.GetCharacter()
			c.AddResistances(8)
		},
		// Chance on melee attack to restore 35 energy.
		4: func(agent core.Agent) {
			c := agent.GetCharacter()
			actionID := core.ActionID{SpellID: 27787}
			energyMetrics := c.NewEnergyMetrics(actionID)

			core.MakeProcTriggerAura(&c.Unit, core.ProcTrigger{
				ActionID: actionID,
				Name:     "Rogue Armor Energize",
				Callback: core.CallbackOnSpellHitDealt,
				Outcome:  core.OutcomeLanded,
				ProcMask: core.ProcMaskMeleeWhiteHit,
				PPM:      1,
				Handler: func(sim *core.Simulation, spell *core.Spell, _ *core.SpellResult) {
					if c.HasEnergyBar() {
						c.AddEnergy(sim, 35, energyMetrics)
					}
				},
			})
		},
		// +8 All Resistances.
		6: func(agent core.Agent) {
			c := agent.GetCharacter()
			c.AddStats(stats.Stats{
				stats.AttackPower:       40,
				stats.RangedAttackPower: 40,
			})
		},
		// +200 Armor.
		8: func(agent core.Agent) {
			c := agent.GetCharacter()
			c.AddStat(stats.Armor, 200)
		},
	},
})

///////////////////////////////////////////////////////////////////////////
//                            Phase 5 Item Sets - Naxx
///////////////////////////////////////////////////////////////////////////