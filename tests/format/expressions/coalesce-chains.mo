/**
 * `??` chains: the one chain family that is not a `bin_exp`, and the break direction it inherits.
 *
 * `coalesce_exp` is its own grammar node (`nodes.generated.ts`), with two structural differences
 * from the binary levels `binary-chains.mo` covers, both measured with `.probe/_coalshape.mts`:
 *
 *  - **the spine leans right.** `a ?? b ?? c` is `coalesce_exp(a, coalesce_exp(b, c))`, the opposite
 *    of the grammar's no-precedence binary levels, which lean left. A flattener that walks
 *    `children[0]` therefore never sees a `??` chain at all.
 *  - **the operator is a bare `Token`, not a `Branch`.** A `bin_exp` level holds `Branch bin_op →
 *    Token "+"`; this one holds `Token "?? "` directly, with the trailing space part of the token
 *    text. `exp.ts`'s `opText` requires a `Branch` and so reports `null`, which is why the coalesce
 *    walk reads its operator inline rather than through the shared helper.
 *
 * Because it is not in `exp.ts`'s `OP_KINDS`, a `??` chain used to fall through every area printer
 * to the source-gap fallback — which reproduces the source's *spaces*, and a space never breaks.
 * Measured before the fix (`.probe/_coal.mts`): the chain below printed at **101 characters** against
 * a width of 80. Across the corpus, the 35 files mentioning `??` went **72 → 47** over-80 lines.
 *
 * The break goes **before** the operator, matching `|>` rather than the binary levels. The operator
 * may not trail a line, and the reason is the guard rather than moc: the lexer's rule is
 * `alias(token(/\?\?[ \t\r\n]/), "??")`, so the trailing whitespace is *inside the token*, and
 * `verify.ts`'s `shapeOf` compares a token's text exactly. Measured on all four spellings
 * (`.probe/_coalverify.mts`) — `a ??\nb` parses in tree-sitter and moc 1.16.1 reports zero syntax
 * errors and builds `NullCoalesceE`, but the re-parse yields the token `"??\n"` where the input had
 * `"?? "`, so the guard refuses it. That is the correct call: the two are different tokens.
 */

// Flat and fitting, so it stays flat. This is the half the guard can see — `line` flattens to a
// single space, so the flat rendering is the source's own `a ?? b ?? c` and the token texts survive.
let short = a ?? b ?? c;

// The 101-character case. Each operand lands on its own line, and the run gets one indent for the
// whole chain rather than one per operator — the same "no nested groups" rule as the binary levels.
let longChain = aaaaaaaaaaaaaaa ?? bbbbbbbbbbbbbbb ?? ccccccccccccccc ?? ddddddddddddddd ?? eeeeeeeeeeeeeeeee;

// One operator is enough to break: the same correction `binary-chains.mo` records for `planChain`,
// where a one-operator chain stayed over `printWidth` until the two-operator minimum was removed.
let singleOperator = proposal_submission_deposit_e8s ?? system_params_reserve_e8s_plus_more;

// No space before the operator. The lexer is `alias(token(/\?\?[ \t\r\n]/), "??")`, so the
// whitespace *after* `??` is inside the token and mandatory — but nothing requires any *before* it,
// and the CST omits that gap when the author did. Measured with `.probe/_coalgap.mts`: `a ?? b` is a
// four-child level, `a?? b` is a **three-child** one, and the two have identical shapes because the
// operator token reads `"?? "` either way. This walk required the four-child form and so fell
// through to the source-gap printer, exactly as the binary walk did — `binary-chains.mo` carries the
// long-form argument, including why no gate can see the difference.
let glued = a?? b;

let gluedChain = aaaaaaaabbbbbbbbbb?? ccccccccccdddddddddd?? eeeeeeeeeeffffffffff;

// A `??` whose operands are themselves calls that break — the operands' own groups are independent
// of the chain's, so each breaks on its own width and the `??` only breaks when the chain does not fit.
let callOperands = someVeryLongFunctionName(argumentOne, argumentTwo) ?? someOtherLongFunction(argumentThree, argumentFour);

// Nesting: the source's parentheses are preserved, so the inner chain is a separate `coalesce_exp`
// that the outer walk stops at — it prints as its own group rather than being flattened together
// with the outer operator, and it fits, so only the outer `??` breaks.
let nested = aaaaaaaaaaaaaaaaaaaaa ?? (bbbbbbbbbbbbbbbbbbbbb ?? ccccccccccccccccccccc ?? ddddddddddddddddddddd);

// A comment inside the level is not flattenable, so the chain falls back to the source-gap printer
// rather than being printed with the comment dropped — `planChain`'s rule, kept identical here.
let withComment = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ?? // keep me
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;

// `??` beside a binary level: the `coalesce_exp` is the outer node here, and its right operand is a
// `bin_exp`, so the chain printer takes the `??` apart and hands the arithmetic to `planChain`.
let mixedWithBinary = aaaaaaaaaaaaaaaaaaaaaaaa ?? bbbbbbbbbbbbbbbbbbbbbb + cccccccccccccccccccccccc;

// The `#` rule from `binary-chains.mo` is about `bin_exp` operators and does not reach this family;
// `??` has no whitespace-sensitive spelling, so a `??` chain containing a `#` still breaks normally
// while the inner `#` chain refuses to.
let withHash = aaaaaaaaaaaaaaaaaaaa # bbbbbbbbbbbbbbbbbbbb ?? cccccccccccccccccccc # dddddddddddddddddddd;
