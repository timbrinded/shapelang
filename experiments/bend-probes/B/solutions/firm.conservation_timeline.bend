# A museum conservator records labeled phases and their durations in ticks.
# Produce each phase's completion time, measured from the start of the work.
# Prove that appending phases splices their timeline after the first total duration.
import Base

type Phases is Data:
  EndPhases{}
  Phase{label: Nat, ticks: Nat, rest: Phases}

def join(xs: Phases, ys: Phases) -> Phases:
  match xs:
    case EndPhases{}:
      ys
    case Phase{label, ticks, rest}:
      Phase{label, ticks, join(rest, ys)}

def elapsed(xs: Phases) -> Nat:
  match xs:
    case EndPhases{}:
      0n
    case Phase{label, ticks, rest}:
      Nat.add(ticks, elapsed(rest))

def delay(+ticks: Nat, xs: Phases) -> Phases:
  match xs:
    case EndPhases{}:
      EndPhases{}
    case Phase{label, time, rest}:
      Phase{label, Nat.add(ticks, time), delay(ticks, rest)}

law timeline:
  for xs: Phases
  Phases

law timeline_empty:
  {timeline(EndPhases{}) == EndPhases{} : Phases}

law timeline_phase:
  for label: Nat
  for ticks: Nat
  for rest: Phases
  {timeline(Phase{label, ticks, rest}) ==
    Phase{label, ticks, delay(ticks, timeline(rest))} : Phases}

law timeline_splice:
  for xs: Phases
  for +ys: Phases
  {timeline(join(xs, ys)) ==
    join(timeline(xs), delay(elapsed(xs), timeline(ys))) : Phases}


def timeline(xs):
  match xs:
    case EndPhases{}:
      EndPhases{}
    case Phase{label, +ticks, rest}:
      Phase{label, ticks, delay(ticks, timeline(rest))}

def timeline_empty():
  {==}

def timeline_phase(label, ticks, rest):
  {==}

law add_assoc:
  for a: Nat
  for b: Nat
  for c: Nat
  {Nat.add(Nat.add(a, b), c) == Nat.add(a, Nat.add(b, c)) : Nat}

def add_assoc(a, b, c):
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_assoc(p, b, c) : {1n+Nat.add(Nat.add(p, b), c) == 1n+_ : Nat}
      {==}

law delay_zero:
  for zs: Phases
  {delay(0n, zs) == zs : Phases}

def delay_zero(zs):
  match zs:
    case EndPhases{}:
      {==}
    case Phase{l, t, r}:
      %delay_zero(r) : {Phase{l, t, delay(0n, r)} == Phase{l, t, _} : Phases}
      {==}

law delay_join:
  for xs: Phases
  for +k: Nat
  for ys: Phases
  {delay(k, join(xs, ys)) == join(delay(k, xs), delay(k, ys)) : Phases}

def delay_join(xs, k, ys):
  match xs:
    case EndPhases{}:
      {==}
    case Phase{l, t, r}:
      %delay_join(r, k, ys) : {Phase{l, Nat.add(k, t), delay(k, join(r, ys))} == Phase{l, Nat.add(k, t), _} : Phases}
      {==}

law delay_delay:
  for zs: Phases
  for +k: Nat
  for +m: Nat
  {delay(k, delay(m, zs)) == delay(Nat.add(k, m), zs) : Phases}

def delay_delay(zs, k, m):
  match zs:
    case EndPhases{}:
      {==}
    case Phase{l, t, r}:
      %delay_delay(r, k, m) : {Phase{l, Nat.add(k, Nat.add(m, t)), delay(k, delay(m, r))} == Phase{l, Nat.add(Nat.add(k, m), t), _} : Phases}
      %add_assoc(k, m, t) : {Phase{l, _, delay(k, delay(m, r))} == Phase{l, Nat.add(Nat.add(k, m), t), delay(k, delay(m, r))} : Phases}
      {==}

def timeline_splice(xs, ys):
  match xs:
    case EndPhases{}:
      %delay_zero(timeline(ys)) : {_ == delay(0n, timeline(ys)) : Phases}
      {==}
    case Phase{l, +t, +r}:
      %delay_delay(timeline(ys), t, elapsed(r)) : {Phase{l, t, delay(t, timeline(join(r, ys)))} == Phase{l, t, join(delay(t, timeline(r)), _)} : Phases}
      %delay_join(timeline(r), t, delay(elapsed(r), timeline(ys))) : {Phase{l, t, delay(t, timeline(join(r, ys)))} == Phase{l, t, _} : Phases}
      %timeline_splice(r, ys) : {Phase{l, t, delay(t, timeline(join(r, ys)))} == Phase{l, t, delay(t, _)} : Phases}
      {==}
