let b1 = { a; };
let b2 = { a };
let b3 = {
  a;
};
let b4 = {
  a
};

let b5 = { a; b };
let b6 = {
  a;
  b;
};

module M1 { let a = 1; };
module M2 { let a = 1 };

type T1 = { #ok : A; };
type T2 = { #ok : A };
type T3 = { x : Nat; };
type T4 = { x : Nat };
type T5 = { #a : Nat; #b : Text };

let a1 = [ 1, ];
let a2 = [ 1 ];
let t1 = ( 1, 2, );
let t2 = ( 1, 2 );
let c1 = f( 1, );
let c2 = f( 1 );

let k1 = [ { abc; } ];
let k2 = [ { abc; }, ];

let v = [
  { a = 1; },
];
let w = [
  { a = 1; }
];

{
}
A;
{
}
.A;
if () {
}
else {};

{
}

{
};
{
}

{
}

{
// }
}
A;
{
//
}
A;
{
}
//
A;

/*

{
// }
};
A

*/

{
}
/**/
A;
{
/**/
}
A;
if () {
}
 /*c*/ else {};
try {
}
 /*c*/ finally {};
{
}
 /*c*/ .A;

if a {}
// Comment
else {};
if a
{}
// Comment
else {};
if a {
}
// Comment
else {};
if a {
}

// Comment
else {};
if a {
}
// Comment
  else
{};
try {}
// Comment
catch e {};
try {}
// Comment
finally {};

(a
,b,c);
(a
,b,c,);
(a,b,c,);
(a, b, c);

[
a,b];
[
a,];
x : [
T
];
let z1 : [ { abc : Nat } ] = 1;
let k = [
  {
    abc;
  },
];

"

{
// }
}
A

";
"\"" # "

{
// }
}
A

";
"{
}";
"
{
}";
"{
}
";
"
{
}
";
"

{
}
";
"
{
}

";

x;
/**/
x;
/*
*/

switch x { case 1 { a }; case 2 { b } };
switch x { case 1 { a }; case 2 { b }; };
switch x { case 1 a; case 2 b };
func f9() : Nat { let x = 1; (x, 2).0 };
