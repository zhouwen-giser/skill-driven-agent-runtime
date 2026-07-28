# Interface Registry Hash Definition

`contractRegistrySha256` / `registrySha256` is the SHA-256 of the canonical JSON registry **with the `registrySha256` field omitted**, serialized with sorted keys and two-space indentation.

Canonical V1.1 base registry hash: `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.

Canonical V1.2 immutable delta registry hash: `8aa828faf544b2cad3d3eb72bfc0935b02ba324a517de1563308862fc7d60dee`.

V1.2 consumers load the V1.1 base and then replace same-named contracts with the V1.2 delta. P00-P02 remain frozen on the V1.1 base.

The exact byte-level file SHA-256 is recorded separately in the bundle `SHA256SUMS.json`.
