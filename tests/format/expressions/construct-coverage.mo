import Prim "mo:⛔";
import  Other  "mo:⛔";

let x = 1;
let y = 2;
let z = x + y;

func foo<A<:Any>(x:A) {};
func foo <A <: Any>(x:A) {};

func ():() {};
func <T> () {};

?{};
do ? {};
do?{};
do? {};

async* T;
func f5() : async* T {};
type T5 = async* Nat;
shared func f5s() : async* T {};

await* t;
func f5b() : async* T { await* t };

f6<() -> (), Nat>();
f6<() -> (), () -> ()>();

switch y { case (x) [x] };
switch y { case (x) [x, x] };
func f7() { switch y { case (x) [x] } };

(
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
  xxxxxxxxxxxxxxxxxxxx,
);

?#abc;
? #abc;
let v9 = ?#abc;

#a;
"A" # b;
"A" # #b;
"A"# b;
"A"#"B";
"A"# #b;
"A" #
"B";

{a and b with c = d};
{a and b with
c = d};
{a and b with 
c = d};
{a and b with
c = d; e = f;};

if(x) { y };
if(
x) { y };
