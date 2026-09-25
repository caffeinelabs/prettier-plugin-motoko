switch (someLongScrutineeExpressionHere) {
case (#alphaVariant) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda;
case (#betaVariant) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda;
case (_) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambda
};

switch (mode) { case #up { +1 }; case #dn { -1 } };

switch x { case (#a) 1 };

switch (someLongScrutineeExpressionHere) {
case (#a) alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXiOmicronPiRhoSigma;
case (_) 2
};

switch (x) { case (#a) 1; case (_) 2; };

switch (x) { case (#a) 1; case (_) 2 };

switch (x) {
case (#alphaVariant) { alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXi1 };
case (#betaVariant) { alphaBetaGammaDeltaEpsilonZetaEtaThetaIotaKappaLambdaMuNuXi2 }
};

switch (a) {
case (#VCon (tag, args)) switch tag { case "0" b; case _ { assert false; #VInt 0 } };
case _ { assert false; #VInt 0 }
};
