let fitsFlat = L.make<Nat, Int>();

let breaksWithCloseGlued = someLongReceiverNameHere.methodName<SomeLongTypeArgumentName, AnotherLongTypeArgumentName>(anArgument);

type LongTypeParameters<SomeLongTypeParameterName, AnotherLongTypeParameterName, AThirdLongOne> = SomeLongTypeParameterName;

let trailingComment = L.make<
    Nat,
    Int // c
>();

let middleComment = L.make<
    Nat, // c
    Int
>();

let blockCommentStaysGlued = L.make<Nat, Int /* c */>();

type TrailingCommentInParameters<A, B // c
> = A;

type ShortParameters<
    A,
    B
> = A;
