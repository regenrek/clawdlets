{ }:

{
  mkSopsSecretFor =
    {
      hostDir,
      owner ? "root",
      group ? "root",
      mode ? "0400",
    }:
    secretName:
    {
      inherit owner group mode;
      sopsFile = "${hostDir}/${secretName}.yaml";
    };
}

