# D5: two arrays in, one written: the law says the read of the other array
# sees its own first cell. Affinity makes a and b distinct in Bend.
import Base

def snd_u(p: Array<U32> & U32) -> U32:
  (a, x) = p
  x

def first(b: Array<U32>) -> U32:
  snd_u(Array.get(U32, b, 0))

# writes 99 into a[0], then reads b[0]
def mark(a: Array<U32>, b: Array<U32>) -> Array<U32> & U32:
  (Array.set(U32, a, 0, 99), first(b))

def second(p: Array<U32> & U32) -> U32:
  (a, x) = p
  x
