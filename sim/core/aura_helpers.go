// Functions for creating common types of auras.
package core

import (
	"math"
	"time"

	"github.com/wowsims/classic/sim/core/stats"
)

type AuraCallback uint16

func (c AuraCallback) Matches(other AuraCallback) bool {
	return (c & other) != 0
}

const (
	CallbackEmpty AuraCallback = 0

	CallbackOnSpellHitDealt AuraCallback = 1 << iota
	CallbackOnSpellHitTaken
	CallbackOnPeriodicDamageDealt
	CallbackOnHealDealt
	CallbackOnPeriodicHealDealt
	CallbackOnCastComplete
)

type ProcHandler func(sim *Simulation, spell *Spell, result *SpellResult)

type ProcTrigger struct {
	Name              string
	ActionID          ActionID
	Duration          time.Duration
	Callback          AuraCallback
	ProcMask          ProcMask
	SpellFlagsExclude SpellFlag
	SpellFlags        SpellFlag
	Outcome           HitOutcome
	Harmful           bool
	ProcChance        float64
	PPM               float64
	ICD               time.Duration
	Handler           ProcHandler
}

func ApplyProcTriggerCallback(unit *Unit, aura *Aura, config ProcTrigger) {
	var icd Cooldown
	if config.ICD != 0 {
		icd = Cooldown{
			Timer:    unit.NewTimer(),
			Duration: config.ICD,
		}
		aura.Icd = &icd
	}

	var ppmm PPMManager
	if config.PPM > 0 {
		ppmm = unit.AutoAttacks.NewPPMManager(config.PPM, config.ProcMask)
	}

	handler := config.Handler
	callback := func(aura *Aura, sim *Simulation, spell *Spell, result *SpellResult) {
		if config.SpellFlags != SpellFlagNone && !spell.Flags.Matches(config.SpellFlags) {
			return
		}
		if config.SpellFlagsExclude != SpellFlagNone && spell.Flags.Matches(config.SpellFlagsExclude) {
			return
		}
		if config.ProcMask != ProcMaskUnknown && !spell.ProcMask.Matches(config.ProcMask) {
			return
		}
		if config.Outcome != OutcomeEmpty && !result.Outcome.Matches(config.Outcome) {
			return
		}
		if config.Harmful && result.Damage == 0 {
			return
		}
		if icd.Duration != 0 && !icd.IsReady(sim) {
			return
		}
		if config.ProcChance != 1 && sim.RandomFloat(config.Name) > config.ProcChance {
			return
		} else if config.PPM != 0 && !ppmm.ProcWithWeaponSpecials(sim, spell.ProcMask, config.Name) {
			return
		}

		if icd.Duration != 0 {
			icd.Use(sim)
		}
		handler(sim, spell, result)
	}

	if config.ProcChance == 0 {
		config.ProcChance = 1
	}

	if config.Callback.Matches(CallbackOnSpellHitDealt) {
		aura.OnSpellHitDealt = callback
	}
	if config.Callback.Matches(CallbackOnSpellHitTaken) {
		aura.OnSpellHitTaken = callback
	}
	if config.Callback.Matches(CallbackOnPeriodicDamageDealt) {
		aura.OnPeriodicDamageDealt = callback
	}
	if config.Callback.Matches(CallbackOnHealDealt) {
		aura.OnHealDealt = callback
	}
	if config.Callback.Matches(CallbackOnPeriodicHealDealt) {
		aura.OnPeriodicHealDealt = callback
	}
	if config.Callback.Matches(CallbackOnCastComplete) {
		aura.OnCastComplete = func(aura *Aura, sim *Simulation, spell *Spell) {
			if config.SpellFlags != SpellFlagNone && !spell.Flags.Matches(config.SpellFlags) {
				return
			}
			if config.ProcMask != ProcMaskUnknown && !spell.ProcMask.Matches(config.ProcMask) {
				return
			}
			if config.SpellFlagsExclude != SpellFlagNone && spell.Flags.Matches(config.SpellFlagsExclude) {
				return
			}
			if icd.Duration != 0 && !icd.IsReady(sim) {
				return
			}
			if config.ProcChance != 1 && sim.RandomFloat(config.Name) > config.ProcChance {
				return
			}

			if icd.Duration != 0 {
				icd.Use(sim)
			}
			handler(sim, spell, nil)
		}
	}
}

func MakeProcTriggerAura(unit *Unit, config ProcTrigger) *Aura {
	aura := Aura{
		Label:           config.Name,
		ActionIDForProc: config.ActionID,
		Duration:        config.Duration,
	}
	if config.Duration == 0 {
		aura.Duration = NeverExpires
		aura.OnReset = func(aura *Aura, sim *Simulation) {
			aura.Activate(sim)
		}
	}

	ApplyProcTriggerCallback(unit, &aura, config)

	return unit.GetOrRegisterAura(aura)
}

type StackingStatAura struct {
	Aura          Aura
	BonusPerStack stats.Stats
}

func MakeStackingAura(character *Character, config StackingStatAura) *Aura {
	bonusPerStack := config.BonusPerStack
	config.Aura.OnStacksChange = func(aura *Aura, sim *Simulation, oldStacks int32, newStacks int32) {
		character.AddStatsDynamic(sim, bonusPerStack.Multiply(float64(newStacks-oldStacks)))
	}
	return character.RegisterAura(config.Aura)
}

// Returns the same Aura for chaining.
func MakePermanent(aura *Aura) *Aura {
	if aura == nil {
		return nil
	}

	aura.Duration = NeverExpires
	if aura.OnReset == nil {
		aura.OnReset = func(aura *Aura, sim *Simulation) {
			aura.Activate(sim)
		}
	} else {
		oldOnReset := aura.OnReset
		aura.OnReset = func(aura *Aura, sim *Simulation) {
			oldOnReset(aura, sim)
			aura.Activate(sim)
		}
	}
	return aura
}

// Helper for the common case of making an aura that adds stats.
func (character *Character) NewTemporaryStatsAura(auraLabel string, actionID ActionID, tempStats stats.Stats, duration time.Duration) *Aura {
	return character.NewTemporaryStatsAuraWrapped(auraLabel, actionID, tempStats, duration, nil)
}

// Alternative that allows modifying the Aura config.
func (character *Character) NewTemporaryStatsAuraWrapped(auraLabel string, actionID ActionID, buffs stats.Stats, duration time.Duration, modConfig func(*Aura)) *Aura {
	// If one of the stat bonuses is a health bonus, then set up healing metrics for the associated
	// heal, since all temporary max health bonuses also instantaneously heal the player.
	var healthMetrics *ResourceMetrics
	var amountHealed float64
	includesHealthBuff := false

	for statIdx, increment := range buffs {
		if stats.Stat(statIdx) == stats.Health && increment > 0 {
			includesHealthBuff = true
			amountHealed = increment
			healthMetrics = character.NewHealthMetrics(actionID)
		}
	}

	config := Aura{
		Label:    auraLabel,
		ActionID: actionID,
		Duration: duration,
		OnGain: func(aura *Aura, sim *Simulation) {
			if sim.Log != nil {
				character.Log(sim, "Gained %s from %s.", buffs.FlatString(), actionID)
			}
			character.AddStatsDynamic(sim, buffs)

			if includesHealthBuff {
				character.GainHealth(sim, amountHealed, healthMetrics)
			}
		},
		OnExpire: func(aura *Aura, sim *Simulation) {
			if sim.Log != nil {
				character.Log(sim, "Lost %s from fading %s.", buffs.FlatString(), actionID)
			}
			character.AddStatsDynamic(sim, buffs.Invert())
		},
	}

	if modConfig != nil {
		modConfig(&config)
	}

	return character.GetOrRegisterAura(config)
}

func ApplyFixedUptimeAura(aura *Aura, uptime float64, tickLength time.Duration, startTime time.Duration) {
	auraDuration := aura.Duration
	ticksPerAura := float64(auraDuration) / float64(tickLength)
	chancePerTick := TernaryFloat64(uptime == 1, 1, 1.0-math.Pow(1-uptime, 1/ticksPerAura))

	aura.Unit.RegisterResetEffect(func(sim *Simulation) {
		StartPeriodicAction(sim, PeriodicActionOptions{
			Period: tickLength,
			OnAction: func(sim *Simulation) {
				if sim.RandomFloat("FixedAura") < chancePerTick {
					aura.Activate(sim)
				}
			},
		})

		// Also try once at the start.
		StartPeriodicAction(sim, PeriodicActionOptions{
			Period:   startTime,
			NumTicks: 1,
			OnAction: func(sim *Simulation) {
				if sim.RandomFloat("FixedAura") < uptime {
					// Use random duration to compensate for increased chance collapsed into single tick.
					randomDur := tickLength + time.Duration(float64(auraDuration-tickLength)*sim.RandomFloat("FixedAuraDur"))

					aura.Duration = randomDur
					aura.Activate(sim)
					aura.Duration = auraDuration
				}
			},
		})
	})
}

// Attaches a StatDependency to a parent Aura
// Note: Only use when parent aura is used through RegisterAura() not GetOrRegisterAura. Otherwise this might apply multiple times.
func (parentAura *Aura) AttachStatDependency(statDep *stats.StatDependency) *Aura {
	parentAura.ApplyOnGain(func(_ *Aura, sim *Simulation) {
		parentAura.Unit.EnableBuildPhaseStatDep(sim, statDep)
	}).ApplyOnExpire(func(aura *Aura, sim *Simulation) {
		parentAura.Unit.DisableBuildPhaseStatDep(sim, statDep)
	})

	return parentAura
}

// Adds Stats to a parent Aura
// Note: Only use when parent aura is used through RegisterAura() not GetOrRegisterAura. Otherwise this might apply multiple times.
func (parentAura *Aura) AttachStatsBuff(stats stats.Stats) *Aura {
	parentAura.ApplyOnGain(func(aura *Aura, sim *Simulation) {
		aura.Unit.AddStatsDynamic(sim, stats)
	}).ApplyOnExpire(func(aura *Aura, sim *Simulation) {
		aura.Unit.AddStatsDynamic(sim, stats.Invert())
	})

	if parentAura.IsActive() {
		parentAura.Unit.AddStats(stats)
	}

	return parentAura
}

// Attaches a multiplicative PseudoStat buff to a parent Aura
func (parentAura *Aura) AttachMultiplicativePseudoStatBuff(fieldPointer *float64, multiplier float64) *Aura {
	parentAura.ApplyOnGain(func(_ *Aura, _ *Simulation) {
		*fieldPointer *= multiplier
	}).ApplyOnExpire(func(_ *Aura, _ *Simulation) {
		*fieldPointer /= multiplier
	})

	if parentAura.IsActive() {
		*fieldPointer *= multiplier
	}

	return parentAura
}

// Attaches an additive PseudoStat buff to a parent Aura
func (parentAura *Aura) AttachAdditivePseudoStatBuff(fieldPointer *float64, bonus float64) *Aura {
	parentAura.ApplyOnGain(func(_ *Aura, _ *Simulation) {
		*fieldPointer += bonus
	}).ApplyOnExpire(func(_ *Aura, _ *Simulation) {
		*fieldPointer -= bonus
	})

	if parentAura.IsActive() {
		*fieldPointer += bonus
	}

	return parentAura
}

// Adds Stats to a parent Aura during build phase
// Note: Only use when parent aura is used through RegisterAura() not GetOrRegisterAura. Otherwise this might apply multiple times.
func (parentAura *Aura) AttachBuildPhaseStatsBuff(stats stats.Stats) *Aura {
	parentAura.ApplyOnGain(func(aura *Aura, sim *Simulation) {
		aura.Unit.AddBuildPhaseStatsDynamic(sim, stats)
	}).ApplyOnExpire(func(aura *Aura, sim *Simulation) {
		aura.Unit.AddBuildPhaseStatsDynamic(sim, stats.Invert())
	})

	return parentAura
}

// Adds a Stat to a parent Aura
// Note: Only use when parent aura is used through RegisterAura() not GetOrRegisterAura. Otherwise this might apply multiple times.
func (parentAura *Aura) AttachStatBuff(stat stats.Stat, value float64) *Aura {
	statsToAdd := stats.Stats{}
	statsToAdd[stat] = value
	parentAura.AttachStatsBuff(statsToAdd)

	return parentAura
}

// Adds a Stat to a parent Aura during build phase
// Note: Only use when parent aura is used through RegisterAura() not GetOrRegisterAura. Otherwise this might apply multiple times.
func (parentAura *Aura) AttachBuildPhaseStatBuff(stat stats.Stat, value float64) *Aura {
	statsToAdd := stats.Stats{}
	statsToAdd[stat] = value
	parentAura.AttachBuildPhaseStatsBuff(statsToAdd)

	return parentAura
}

// Adds a Attack Speed Multiplier to a parent Aura
// Note: Only use when parent aura is used through RegisterAura() not GetOrRegisterAura. Otherwise this might apply multiple times.
func (parentAura *Aura) AttachMultiplyAttackSpeed(unit *Unit, value float64) *Aura {
	parentAura.ApplyOnGain(func(aura *Aura, sim *Simulation) {
		unit.MultiplyAttackSpeed(sim, value)
	}).ApplyOnExpire(func(aura *Aura, sim *Simulation) {
		unit.MultiplyAttackSpeed(sim, 1/value)
	})
	return parentAura
}

// Adds a Cast Speed Multiplier Stat to a parent Aura
// Note: Only use when parent aura is used through RegisterAura() not GetOrRegisterAura. Otherwise this might apply multiple times.
func (parentAura *Aura) AttachMultiplyCastSpeed(unit *Unit, value float64) *Aura {
	parentAura.ApplyOnGain(func(aura *Aura, sim *Simulation) {
		unit.MultiplyCastSpeed(value)
	}).ApplyOnExpire(func(aura *Aura, sim *Simulation) {
		unit.MultiplyCastSpeed(1 / value)
	})
	return parentAura
}
