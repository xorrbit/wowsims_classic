package shaman

import (
	"time"

	"github.com/wowsims/classic/sim/core"
)

const ChainHealRanks = 3
const ChainHealTargetCount = int32(3)

var ChainHealSpellId = [ChainHealRanks + 1]int32{0, 1064, 10622, 10623}
var ChainHealBaseHealing = [ChainHealRanks + 1][]float64{{0}, {332, 381}, {416, 477}, {567, 646}}
var ChainHealSpellCoef = [ChainHealRanks + 1]float64{0, .714, .714, .714}
var ChainHealCastTime = [ChainHealRanks + 1]int32{0, 2500, 2500, 2500}
var ChainHealManaCost = [ChainHealRanks + 1]float64{0, 260, 315, 405}
var ChainHealLevel = [ChainHealRanks + 1]int{0, 40, 46, 54}

func (shaman *Shaman) registerChainHealSpell() {
	shaman.ChainHeal = make([]*core.Spell, ChainHealRanks+1)

	for rank := 1; rank <= ChainHealRanks; rank++ {
		config := shaman.newChainHealSpellConfig(rank, false)

		if config.RequiredLevel <= int(shaman.Level) {
			shaman.ChainHeal[rank] = shaman.RegisterSpell(config)
		}
	}
}

func (shaman *Shaman) newChainHealSpellConfig(rank int, isOverload bool) core.SpellConfig {
	spellId := ChainHealSpellId[rank]
	baseHealingMultiplier := 1 + shaman.purificationHealingModifier()
	baseHealingLow := ChainHealBaseHealing[rank][0] * baseHealingMultiplier
	baseHealingHigh := ChainHealBaseHealing[rank][1] * baseHealingMultiplier
	spellCoeff := ChainHealSpellCoef[rank]
	castTime := ChainHealCastTime[rank]
	manaCost := ChainHealManaCost[rank]
	level := ChainHealLevel[rank]

	bounceCoef := 0.50 // 50% reduction per bounce
	targetCount := ChainHealTargetCount

	return core.SpellConfig{
		ActionID:    core.ActionID{SpellID: spellId},
		SpellCode:   SpellCode_ShamanChainHeal,
		DefenseType: core.DefenseTypeMagic,
		SpellSchool: core.SpellSchoolNature,
		ProcMask:    core.ProcMaskSpellHealing,
		Flags:       core.SpellFlagHelpful | core.SpellFlagAPL | SpellFlagShaman,

		RequiredLevel: level,
		Rank:          rank,

		ManaCost: core.ManaCostOptions{
			FlatCost: manaCost,
		},

		Cast: core.CastConfig{
			DefaultCast: core.Cast{
				GCD:      core.GCDDefault,
				CastTime: time.Millisecond * time.Duration(castTime),
			},
		},

		DamageMultiplier: 1,
		ThreatMultiplier: 1,
		BonusCoefficient: spellCoeff,

		ApplyEffects: func(sim *core.Simulation, target *core.Unit, spell *core.Spell) {
			targets := sim.Environment.Raid.GetFirstNPlayersOrPets(targetCount)
			curTarget := targets[0]
			origMult := spell.DamageMultiplier
			// TODO: This bounces to most hurt friendly...
			for hitIndex := 0; hitIndex < len(targets); hitIndex++ {
				originalDamageMultiplier := spell.DamageMultiplier
				spell.CalcAndDealHealing(sim, curTarget, sim.Roll(baseHealingLow, baseHealingHigh), spell.OutcomeHealingCrit)
				spell.DamageMultiplier = originalDamageMultiplier
				spell.DamageMultiplier *= bounceCoef

				curTarget = targets[hitIndex]
			}
			spell.DamageMultiplier = origMult
		},
	}
}
