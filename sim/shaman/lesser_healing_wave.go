package shaman

import (
	"time"

	"github.com/wowsims/classic/sim/core"
)

const LesserHealingWaveRanks = 6

var LesserHealingWaveSpellId = [LesserHealingWaveRanks + 1]int32{0, 8004, 8008, 8010, 10466, 10467, 10468}
var LesserHealingWaveBaseHealing = [LesserHealingWaveRanks + 1][]float64{{0}, {170, 195}, {257, 292}, {347, 391}, {473, 529}, {649, 723}, {832, 928}}
var LesserHealingWaveSpellCoef = [LesserHealingWaveRanks + 1]float64{0, .429, .429, .429, .429, .429, .429}
var LesserHealingWaveCastTime = [LesserHealingWaveRanks + 1]int32{0, 1500, 1500, 1500, 1500, 1500, 1500}
var LesserHealingWaveManaCost = [LesserHealingWaveRanks + 1]float64{0, 105, 145, 185, 235, 305, 380}
var LesserHealingWaveLevel = [LesserHealingWaveRanks + 1]int{0, 20, 28, 36, 44, 52, 60}

func (shaman *Shaman) registerLesserHealingWaveSpell() {
	shaman.LesserHealingWave = make([]*core.Spell, LesserHealingWaveRanks+1)

	for rank := 1; rank <= LesserHealingWaveRanks; rank++ {
		config := shaman.newLesserHealingWaveSpellConfig(rank)

		if config.RequiredLevel <= int(shaman.Level) {
			shaman.LesserHealingWave[rank] = shaman.RegisterSpell(config)
		}
	}
}

func (shaman *Shaman) newLesserHealingWaveSpellConfig(rank int) core.SpellConfig {
	spellId := LesserHealingWaveSpellId[rank]
	baseHealingMultiplier := 1 + shaman.purificationHealingModifier()
	baseHealingLow := LesserHealingWaveBaseHealing[rank][0] * baseHealingMultiplier
	baseHealingHigh := LesserHealingWaveBaseHealing[rank][1] * baseHealingMultiplier
	spellCoeff := LesserHealingWaveSpellCoef[rank]
	castTime := LesserHealingWaveCastTime[rank]
	manaCost := LesserHealingWaveManaCost[rank]
	level := LesserHealingWaveLevel[rank]

	switch shaman.Ranged().ID {
	case TotemOfTheStorm:
		baseHealingLow += 53
		baseHealingHigh += 53
	}

	return core.SpellConfig{
		ActionID:     core.ActionID{SpellID: spellId},
		SpellCode:    SpellCode_ShamanLesserHealingWave,
		SpellSchool:  core.SpellSchoolNature,
		DefenseType:  core.DefenseTypeMagic,
		ProcMask:     core.ProcMaskSpellHealing,
		Flags:        core.SpellFlagHelpful | core.SpellFlagAPL | SpellFlagShaman,
		MetricSplits: 6,

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
			ModifyCast: func(sim *core.Simulation, spell *core.Spell, cast *core.Cast) {
				castTime := shaman.ApplyCastSpeedForSpell(cast.CastTime, spell)
				shaman.AutoAttacks.StopMeleeUntil(sim, sim.CurrentTime+castTime, false)
			},
		},

		DamageMultiplier: 1,
		ThreatMultiplier: 1,
		BonusCoefficient: spellCoeff,

		ApplyEffects: func(sim *core.Simulation, target *core.Unit, spell *core.Spell) {
			spell.CalcAndDealHealing(sim, spell.Unit, sim.Roll(baseHealingLow, baseHealingHigh), spell.OutcomeHealingCrit)
		},
	}
}
