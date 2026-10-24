# An inventory tracker merges warehouse shelf trees from left to right.
# Empty shelves are pruned and unary branches collapsed. Prove this
# cleanup preserves the order of every item in the merged inventory.
import Base

type Shelf is Data:
  Vacant{}
  Stock{item: Nat}
  Aisle{left: Shelf, right: Shelf}

def cat(xs: List<Nat>, ys: List<Nat>) -> List<Nat>:
  match xs:
    case Nil{}: ys
    case Con{h, t}: Con{h, cat(t, ys)}

def items(s: Shelf) -> List<Nat>:
  match s:
    case Vacant{}: Nil{}
    case Stock{item}: [item]
    case Aisle{left, right}: cat(items(left), items(right))

def join(a: Shelf, b: Shelf) -> Shelf:
  match a:
    case Vacant{}: b
    case Stock{item}:
      match b:
        case Vacant{}: Stock{item}
        case Stock{other}: Aisle{Stock{item}, Stock{other}}
        case Aisle{left, right}: Aisle{Stock{item}, Aisle{left, right}}
    case Aisle{left, right}:
      match b:
        case Vacant{}: Aisle{left, right}
        case Stock{item}: Aisle{Aisle{left, right}, Stock{item}}
        case Aisle{x, y}: Aisle{Aisle{left, right}, Aisle{x, y}}

def prune(s: Shelf) -> Shelf:
  match s:
    case Vacant{}: Vacant{}
    case Stock{item}: Stock{item}
    case Aisle{left, right}: join(prune(left), prune(right))

law merged_inventory:
  for a: Shelf
  for b: Shelf
  {items(prune(Aisle{a, b})) == cat(items(a), items(b)) : List<Nat>}


law cat_nil:
  for xs: List<Nat>
  {cat(xs, Nil{}) == xs : List<Nat>}

def cat_nil(xs):
  match xs:
    case Nil{}:
      {==}
    case Con{h, t}:
      %cat_nil(t) : {Con{h, cat(t, Nil{})} == Con{h, _} : List<Nat>}
      {==}

law join_items:
  for x: Shelf
  for y: Shelf
  {items(join(x, y)) == cat(items(x), items(y)) : List<Nat>}

def join_items(x, y):
  match x:
    case Vacant{}:
      {==}
    case Stock{i}:
      match y:
        case Vacant{}:
          {==}
        case Stock{o}:
          {==}
        case Aisle{p, q}:
          {==}
    case Aisle{+l, +r}:
      match y:
        case Vacant{}:
          %cat_nil(cat(items(l), items(r))) : {_ == cat(cat(items(l), items(r)), Nil{}) : List<Nat>}
          {==}
        case Stock{o}:
          {==}
        case Aisle{p, q}:
          {==}

law prune_items:
  for s: Shelf
  {items(prune(s)) == items(s) : List<Nat>}

def prune_items(s):
  match s:
    case Vacant{}:
      {==}
    case Stock{i}:
      {==}
    case Aisle{+l, +r}:
      %prune_items(l) : {items(join(prune(l), prune(r))) == cat(_, items(r)) : List<Nat>}
      %prune_items(r) : {items(join(prune(l), prune(r))) == cat(items(prune(l)), _) : List<Nat>}
      join_items(prune(l), prune(r))

def merged_inventory(a, b):
  prune_items(Aisle{a, b})
