
public type T = {
  x : [
    {
      a : A;
      fn : shared query A -> async T;
    }
  ];
}