/**
 * Member chains: which link owns the break, and the two spines this module refuses.
 *
 * `docs/style.md` §"Member chains" asks for one `.`-link per line, broken **before** the `.`, once a
 * chain does not fit — the same shape and direction the `|>` pipeline rule uses. The source-gap
 * printer this area replaced could not produce it, and its failure was worse than a long line: a call
 * link's own `par_exp` is a breakable list, so it was the only break candidate under the node and the
 * chain broke *inside* the argument list instead. `breakAtArguments` is that shape as a single call,
 * and `defectCase` is the one that moved a break to the wrong side of a `.`.
 *
 * Every case is written in the spelling least like the answer, so the snapshot records the printer's
 * decision rather than the source's layout. The last section is the interesting half: `chain.ts`
 * refuses a receiver that is itself a call, and *composes* with a number projection, and the two are
 * different outcomes for a reason the header of `src/printer/chain.ts` spells out.
 *
 * ## Why every case is `let x = <chain>;`
 *
 * A bare expression statement would be an `exp_dec`, and its own `;` is a source-file-level sibling
 * rather than part of the chain — so a chain printed as a declaration adds a token this fixture would
 * then be asserting. Binding it with `let` keeps the chain the only thing under test.
 */

// The style guide's own worked example, written flat: seven calls, seven links, far over
// `printWidth`. Every `.` takes a line at one indent level, and the receiver stays on the `let` line.
let workedExample = x.repeat(50).repeat(50).repeat(50).repeat(50).repeat(50).repeat(50).repeat(50);

// The old test from `tests/legacy/formatter.test.ts`, which is the only concrete evidence for the
// threshold and is why it is a count of *links* and not of calls: these are two dots and **no calls
// at all**, and both break. A threshold of "more than two calls" would refuse the very case
// `docs/style.md`'s ruling cites, which is the trap the header documents.
let twoDotsNoCalls = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx;

// The defect this area exists for. Before the chain printer, the source-gap fallback found the
// `par_exp` under `.someVeryLong…(aLongArgumentHere)` — the only break candidate — and produced
// `).bar(\n  1\n)`: a break between a call and the argument list that *follows* it, which is neither
// shape the rule allows. Now the break belongs to each `.` and the field link takes a line of its own.
let defectCase = x.field.someVeryLongFunctionNameThatIsQuiteLongIndeed(aLongArgumentHere).bar(1);

// Two calls, which the rule's prose reads as "two or fewer" and therefore exempt: it says such a
// chain "breaks at the arguments instead". Written flat and over `printWidth`, this printer still
// lays it out one link per line, and the snapshot records that on purpose — the prose's count is not
// the threshold, `twoDotsNoCalls` is. See the header for why the weaker reading wins.
let twoCalls = someLongReceiverNameHere.alphaBetaGammaDelta(someLongArgumentName).epsilonZetaEtaTheta(1);

// A field-only chain: no `call_exp` link at all, and the *same* spine walk — `children[0]` bottoms out
// on a `var_exp` here and on a `call_exp` in `workedExample`, which is why the receiver is stored
// whole and handed to the shared printer rather than reconstructed.
let fieldOnly = someVeryLongReceiverNameHere.alphaBetaGammaDelta.epsilonZetaEtaTheta.iotaKappaLambdaMu;

// Below the floor: one link, so there is no chain rule to apply and no break to make. It fits, so the
// flat form — which is the source's own text character for character — is the fixed point.
let shortChain = x.foo(a).bar(b);

// The style guide's counter-example: "A chain with two or fewer calls does not use the chain rule at
// all, even when it overflows `printWidth`: it breaks at the arguments instead." This is one call, so
// the module never sees it and the `par_exp` breaks itself — the layout the rule asks for.
let breakAtArguments = xs.map(func (x : Nat) : Nat { return x + 1; });

// A chain that fits stays flat, including one with a break in the source before the `.`: the printed
// form is the source's own text with the gap dropped, so it is a fixed point.
let spacedSource = someLongReceiverNameHere
    .alphaBetaGammaDelta(a)
    .epsilonZetaEtaTheta(b);

// A receiver that is itself a call is refused — `planChain` leaves a link's name unfilled when a
// `call_exp`'s callee is not a `dot_exp`, and an unfilled name would print `.undefined`. Refusing puts
// the node back on the source-gap fallback, which is *correct* and merely unbroken; the fallback's
// recursion still reaches the receiver's `par_exp`, so `f(` takes its own break and the rest runs long.
let receiverIsACall = f(a).alphaBetaGammaDelta().epsilonZetaEtaTheta().iotaKappaLambdaMuNuXiOmicronPiRho();

// A number projection is **not** refused, and the difference is worth recording. `x.1` is a
// `proj_exp`, not a `dot_exp`, and it sits at the *top* of the spine — so this module is called on the
// `proj_exp`, refuses it, and the fallback prints its children: the inner chain, which this module
// *does* own, and then the projection glued to it. The last link therefore reads `.epsilonZetaEtaTheta.1`
// with no break before the `.1`, and that is the fallback's decision rather than this module's.
let projected = someVeryLongReceiverNameHere.alphaBetaGammaDelta(aLongArgument).epsilonZetaEtaTheta.1;

// A chain nested inside an argument sits inside a link's own `par_exp` and does not disturb the spine,
// so the outer chain's break and the argument's break are independent.
let nestedInArgument = outerFunction(innerObject.someLongMethodName(anotherArgument).andAnotherMethod(1)).call();

// An `array_idx_exp` head: the walk bottoms out on the index rather than a `var_exp`, which is the
// point of terminating on an unknown *kind* instead of asserting a receiver shape.
let indexedHead = someLongArrayNameHere[0].alphaBetaGammaDelta(a).epsilonZetaEtaTheta(b).iotaKappaL(1);
