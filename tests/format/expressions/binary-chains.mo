/**
 * Binary chains: the rule `docs/style.md` states, and the two operators that opt out of it.
 *
 * Every chain here is written *flat* in the source and does not fit `printWidth` at 80 once the
 * printer has chosen where to break, so the snapshot records the break direction rather than the
 * source's own layout. That is the point of the area: the source-gap printer a chain falls back to
 * reproduces the source's *spaces*, and a space never breaks, so before this area printer existed
 * every one of these stayed on one over-long line.
 *
 * The last section is the interesting half. `#` and the §2.7 indivisible set must not trail a line,
 * so their chains refuse to break at all and fall back to the long line — the comment on each
 * records which gate is blind to why.
 */

let arithmetic = alphaBetaGamma + deltaEpsilonZeta + etaThetaIota + kappaLambdaMu;

let mixedPrecedence = alphaBetaGamma + deltaEpsilonZeta * etaThetaIota - kappaLambdaMu;

let booleanChain = alphaBetaGamma and deltaEpsilonZeta or etaThetaIota and kappaLambdaMu;

let comparisonChain = alphaBetaGamma == deltaEpsilonZeta or etaThetaIota < kappaLambdaMu;

// A chain that fits stays flat, because `line` flattens to a single space and the flat form is
// exactly the source's own spacing. This is the half that the runtime guard can see.
let short = a + b + c;

// A one-operator chain still breaks: `dao.mo` in the corpus is the counter-example that removed
// the first draft's two-operator minimum.
let single = proposal_submission_deposit_e8s + system_params_reserve_e8s_plus_more;

// `|>` breaks *before* each operator, the opposite direction to every chain above.
let pipeline = [1, 2, 3] |> Array.map(func(x : Nat) : Nat { x + 1 }) |> Array.filter(func x { x > 1 }) |> Array.size;

// A comment inside a `bin_op` is not flattenable, so the whole chain falls back to the source-gap
// printer rather than being printed with the comment dropped.
let withComment = alphaBetaGamma + // keep me
    deltaEpsilonZeta;

// `#` must not end a line: a tight `#` is a variant tag and a spaced `#` is concatenation, so a
// break beside it is a role change. moc 1.16.0 accepts the break, and tree-sitter reports SAME for
// all three spellings, so only the printer can refuse it — the line stays long on purpose.
let concatStaysLong = alphaBetaGammaDelta # deltaEpsilonZetaEta # thetaIotaKappaLambda;

// §2.7: a shift is one token, so it never trails a line either — same refusal, same reason.
let shiftStaysLong = aaaaaaaabbbbbbbb >> ccccccccdddddddd;
