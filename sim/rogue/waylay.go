package rogue

import (
	"github.com/wowsims/classic/sim/core"
	"github.com/wowsims/classic/sim/core/proto"
)

func (rogue *Rogue) registerWaylayAura() {
	if !rogue.HasRune(proto.RogueRune_RuneWaylay) {
		return
	}

	rogue.WaylayAuras = rogue.NewEnemyAuraArray(func(target *core.Unit, level int32) *core.Aura {
		return core.WaylayAura(target)
	})
}
