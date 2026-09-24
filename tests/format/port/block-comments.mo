// Ported from the 0.13.0 suite: `block comments` (formatter).
//
// Verdict: 19 already identical to 0.13, 1 changed on purpose, 1 deleted as a bug.
//
// 1 × breaks placed differently:
//   - [10] line 1: 0.13 "let /*{{*/ x = 0; //x" → now "let/*{{*/x = 0; //x"
//
// 1 case(s) of this name are refusals — the parse throws, so they cannot be
// a fixture here. They are pinned in `tests/refusals/` (see `tests/refusals.test.ts`).
//
// The body below is the legacy input byte-for-byte; the snapshot records what the
// printer does to it, and `tests/format.test.ts` also asserts it is a fixed point.
/**/

/***/

/****/

/*****/

/******/

/*******/

/********/

/*********/

/**********/

/***********/

let/*{{*/x = 0;//x
 (x)
/**//**/

/**/


/**/
/*=*/

/**=*/

/**=**/

/** **/

/*** **/

/** ***/

/****
-----
******/
