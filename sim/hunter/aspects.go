package hunter

import (
	"strconv"
	"time"

	"github.com/wowsims/classic/sim/core"
	"github.com/wowsims/classic/sim/core/stats"
)

// Utility function to create an Improved Hawk Aura
func (hunter *Hunter) createImprovedHawkAura(auraLabel string, actionID core.ActionID, isMelee bool) *core.Aura {
	bonusMultiplier := 1.3
	return hunter.GetOrRegisterAura(core.Aura{
		Label:    auraLabel,
		ActionID: actionID,
		Duration: time.Second * 12,
		OnGain: func(aura *core.Aura, sim *core.Simulation) {
			if isMelee {
				aura.Unit.MultiplyMeleeSpeed(sim, bonusMultiplier)
			} else {
				aura.Unit.MultiplyRangedSpeed(sim, bonusMultiplier)
			}
		},
		OnExpire: func(aura *core.Aura, sim *core.Simulation) {
			if isMelee {
				aura.Unit.MultiplyMeleeSpeed(sim, 1/bonusMultiplier)
			} else {
				aura.Unit.MultiplyRangedSpeed(sim, 1/bonusMultiplier)
			}
		},
	})
}

// Function to get the maximum attack power for Aspect of the Hawk based on rank
func (hunter *Hunter) getMaxAspectOfTheHawkAttackPower(rank int) float64 {
	attackPower := [8]float64{0, 20, 35, 50, 70, 90, 110, 120}

	if rank < 1 || rank > 7 {
		return 0.0
	}

	return attackPower[rank]
}

func (hunter *Hunter) getMaxHawkRank() int {
	maxRank := core.TernaryInt(core.IncludeAQ, 7, 6)

	for i := maxRank; i > 0; i-- {
		config := hunter.getAspectOfTheHawkSpellConfig(i)
		if config.RequiredLevel <= int(hunter.Level) {
			return i
		}
	}
	return 1
}

func (hunter *Hunter) getAspectOfTheHawkSpellConfig(rank int) core.SpellConfig {
	var impHawkAura *core.Aura
	improvedHawkProcChance := 0.01 * float64(hunter.Talents.ImprovedAspectOfTheHawk)

	spellIds := [8]int32{0, 13165, 14318, 14319, 14320, 14321, 14322, 25296}
	levels := [8]int{0, 10, 18, 28, 38, 48, 58, 60}

	spellId := spellIds[rank]
	level := levels[rank]

	if hunter.Talents.ImprovedAspectOfTheHawk > 0 {
		impHawkAura = hunter.createImprovedHawkAura(
			"Quick Shots",
			core.ActionID{SpellID: 6150},
			false, // Ranged
		)
	}
	// Use utility function to get the attack power based on rank
	rap := hunter.getMaxAspectOfTheHawkAttackPower(rank)

	actionID := core.ActionID{SpellID: spellId}
	aspectOfTheHawkAura := hunter.NewTemporaryStatsAuraWrapped(
		"Aspect of the Hawk"+strconv.Itoa(rank),
		actionID,
		stats.Stats{stats.RangedAttackPower: rap},
		core.NeverExpires,
		func(aura *core.Aura) {
			aura.OnSpellHitDealt = func(aura *core.Aura, sim *core.Simulation, spell *core.Spell, result *core.SpellResult) {
				if !spell.ProcMask.Matches(core.ProcMaskRangedAuto) {
					return
				}

				if impHawkAura != nil && sim.Proc(improvedHawkProcChance, "Imp Aspect of the Hawk") {
					impHawkAura.Activate(sim)
				}
			}
		})

	aspectOfTheHawkAura.NewExclusiveEffect("Aspect", true, core.ExclusiveEffect{})

	return core.SpellConfig{
		ActionID:      actionID,
		Flags:         core.SpellFlagAPL,
		Rank:          rank,
		RequiredLevel: level,

		Cast: core.CastConfig{
			DefaultCast: core.Cast{
				GCD: core.GCDDefault,
			},
		},
		ExtraCastCondition: func(sim *core.Simulation, target *core.Unit) bool {
			return !aspectOfTheHawkAura.IsActive()
		},

		ApplyEffects: func(sim *core.Simulation, _ *core.Unit, _ *core.Spell) {
			aspectOfTheHawkAura.Activate(sim)
		},
	}
}

func (hunter *Hunter) registerAspectOfTheHawkSpell() {
	maxRank := hunter.getMaxHawkRank()
	config := hunter.getAspectOfTheHawkSpellConfig(maxRank)
	hunter.GetOrRegisterSpell(config)
}