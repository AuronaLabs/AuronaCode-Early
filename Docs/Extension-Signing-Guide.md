# Extension Signing Guide

Aurona Code uses two installation paths with different trust statements.

## Local Development Packages

Select a `.aurx` file from Marketplace's **Install Local (.aurx)** action. Rust copies the file into a bounded temporary artifact, records its byte count and SHA-256, binds it to the current workspace generation, and returns a one-time artifact ID. Before installation the native dialog shows the package identity, hash and size. A local package is not presented as publisher-verified; the user is explicitly approving that package for local use.

## Remote Marketplace Packages

Remote installation requires all of the following:

1. The download URL resolves to the official Marketplace origin.
2. A current signed catalog contains the requested extension and version.
3. The response includes a signed artifact descriptor.
4. The pinned Ed25519 key verifies the descriptor and the descriptor binds publisher, extension ID, version, platform, source, catalog revision, expiry, size and SHA-256.
5. The downloaded bytes match the signed size and hash before installation.

Missing or invalid production signatures are an expected external blocking state. The client reports the reason and keeps the package out of the verified installation path. Test fixtures under `src-tauri/resources/security-fixtures` validate the client protocol only; they are not production signing material.

## Key Configuration

Production builds provide `AURONA_ARTIFACT_PUBLIC_KEYS` at compile time as a JSON object mapping key IDs to base64 Ed25519 public keys. The default is empty and fails closed. Private signing keys and Marketplace catalog credentials must remain outside this repository and outside local release artifacts.
