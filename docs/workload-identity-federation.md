# Workload Identity Federation — How It Works

## The Problem It Solves

Before federation existed, if you wanted GitHub Actions to deploy to Azure, you had to:

1. Create a **Service Principal** (essentially a "robot user" in Azure)
2. Generate a **secret/password** for it
3. Store that secret in GitHub
4. Azure would trust that password

The problem: **secrets can leak**. If someone steals the secret from GitHub, they can deploy to your Azure account from anywhere in the world. Secrets also expire and need rotating.

Workload Identity Federation solves this by **eliminating the secret entirely**.

---

## The Core Idea: "I Trust What GitHub Says About Itself"

Think of it like this:

> You're a bouncer at a club. Normally you let someone in if they show you a password.
> But passwords can be stolen.
>
> A better approach: you call the DMV directly and ask "is this person who they say they are?"
> The DMV is an authoritative source — you trust *them*, not the piece of paper someone hands you.

In our case:
- **GitHub** is the person trying to get in
- **Azure** is the bouncer
- **GitHub's OIDC server** is the DMV — an authoritative, tamper-proof source of truth

---

## What Is OIDC?

**OIDC = OpenID Connect**. It's a standard protocol for "proving who you are" across the internet.

When a GitHub Actions job runs, GitHub's servers issue a **JWT token** (a signed digital certificate) that says:

```
"This request is coming from:
  - Repository: ahelal/fomo
  - Branch: refs/heads/main
  - Environment: production
  - Workflow run: #42
  Signed by: GitHub (token.actions.githubusercontent.com)"
```

This token is **cryptographically signed** by GitHub. You cannot fake it — only GitHub's servers can produce it.

---

## What Is a JWT Token?

A JWT (JSON Web Token) is a tiny document split into 3 parts, separated by dots:

```
eyJhbGciOiJSUzI1NiJ9   ← Header (what algorithm was used)
.
eyJzdWIiOiJyZXBvOmFoZWxhbC9mb21vOnJlZjpyZWZzL2hlYWRzL21haW4ifQ  ← Payload (the claims)
.
SflKxwRJSMeKKF2QT4fwp...  ← Signature (proof it wasn't tampered with)
```

The payload (middle part) decoded looks like:
```json
{
  "iss": "https://token.actions.githubusercontent.com",
  "sub": "repo:ahelal/fomo:ref:refs/heads/main",
  "aud": "api://AzureADTokenExchange",
  "repository": "ahelal/fomo",
  "workflow": "Deploy",
  "ref": "refs/heads/main",
  "environment": "production"
}
```

Anyone can *read* this token, but only GitHub can *produce* a valid signature for it. Azure can verify the signature by checking GitHub's public keys (published at a known URL).

---

## The Full Flow, Step by Step

```
GitHub Actions Job Starts
         │
         ▼
1. GitHub issues a signed OIDC token
   "I am workflow run from repo:ahelal/fomo, branch:main"
         │
         ▼
2. Your workflow calls azure/login@v2
   passing client-id, tenant-id, subscription-id (NOT a secret)
         │
         ▼
3. azure/login sends the OIDC token to Azure (Entra ID)
   "Here's GitHub's token. Can I have an Azure access token?"
         │
         ▼
4. Azure checks:
   a. Is the token signature valid? (asks GitHub's OIDC endpoint)
   b. Does the token's "subject" match a trusted federated credential?
      → "repo:ahelal/fomo:environment:production" ✓
         │
         ▼
5. Azure issues a short-lived access token (valid ~1 hour)
         │
         ▼
6. GitHub Actions uses that token to call Azure APIs
   (deploy, build image, update Container App, etc.)
         │
         ▼
7. Token expires. Nothing to clean up, nothing to rotate.
```

---

## What Was Done on Azure — Exact Commands

Three `az` CLI commands were run. Here's what each one does and why.

---

### Step 1 — Create a Managed Identity

```bash
az identity create \
  --name fomo-github-actions \
  --resource-group fomo \
  --location swedencentral
```

**What this does:** Creates a new identity object inside Azure called `fomo-github-actions`.  
Think of it like adding a new employee to your company directory — no badge yet, no access yet, just a name and an ID number.

It has **no password, no secret, nothing**. It's just a named slot.

Output gave us two important IDs:
```
clientId:    <client-id>         ← used in GitHub workflow
principalId: <principal-id>      ← used for role assignment
tenantId:    <tenant-id>         ← your Azure directory
```

---

### Step 2 — Give It Permission to Deploy

```bash
az role assignment create \
  --role Contributor \
  --assignee <principal-id> \
  --scope /subscriptions/<subscription-id>/resourceGroups/fomo
```

**What this does:** Grants the managed identity **Contributor** access to the `fomo` resource group.  
This is like giving that new employee a key card that only opens the doors in one office — not the whole building.

Without this step, the identity exists but can't do anything.

---

### Step 3 — Create the Trust Link with GitHub (THE KEY STEP)

This is where you tell Azure *"I trust GitHub's identity claims"*. Two federated credentials were created:

**Credential 1 — for pushes to main branch:**
```bash
az identity federated-credential create \
  --name github-main \
  --identity-name fomo-github-actions \
  --resource-group fomo \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:ahelal/fomo:ref:refs/heads/main \
  --audiences api://AzureADTokenExchange
```

**Credential 2 — for the production environment:**
```bash
az identity federated-credential create \
  --name github-workflow \
  --identity-name fomo-github-actions \
  --resource-group fomo \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:ahelal/fomo:environment:production \
  --audiences api://AzureADTokenExchange
```

**What each field means:**

| Field | Value | Meaning |
|-------|-------|---------|
| `--issuer` | `https://token.actions.githubusercontent.com` | "Trust tokens that come from GitHub's OIDC server" |
| `--subject` | `repo:ahelal/fomo:ref:refs/heads/main` | "Only if the token says it's from THIS repo on THIS branch" |
| `--audiences` | `api://AzureADTokenExchange` | Standard Azure value — means "this token is for exchanging with Azure" |

The `--subject` is the **security boundary**. If someone from a different repo, or a PR branch, or a fork tries to authenticate, their token's subject won't match — Azure rejects it.

You can verify what was created in the Azure Portal:  
**Entra ID → Managed Identities → fomo-github-actions → Federated credentials**

---

## What We Set Up (Summary)

### 1. User-Assigned Managed Identity

```
Name:        fomo-github-actions
Resource:    fomo resource group
Client ID:   <client-id>
```

An identity object in Azure with no password. Just a named, addressable entity.

### 2. Role Assignment

```
Who:   fomo-github-actions
Role:  Contributor
Scope: resourceGroups/fomo
```

Contributor means: can create/update/delete resources inside that RG, but cannot change access policies.

### 3. Federated Credentials

This is the key piece — it's a rule that says *"when Azure receives a GitHub OIDC token matching this pattern, trust it as this identity"*:

```
Credential 1 — for pushes to main:
  Issuer:  https://token.actions.githubusercontent.com
  Subject: repo:ahelal/fomo:ref:refs/heads/main

Credential 2 — for the production environment:
  Issuer:  https://token.actions.githubusercontent.com
  Subject: repo:ahelal/fomo:environment:production
```

If the token's `sub` field doesn't exactly match one of these patterns, Azure rejects it. This means:
- Only `ahelal/fomo` repo can use this identity (not any other GitHub repo)
- Only the `main` branch or `production` environment (not a PR branch or fork)

---

## What GitHub Needs

### Variables (not sensitive — safe to be public)

| Variable | Value | Why |
|----------|-------|-----|
| `AZURE_CLIENT_ID` | `8e2414b5-...` | Tells Azure *which* managed identity to use |
| `AZURE_TENANT_ID` | `d86f7b32-...` | Tells Azure *which directory* (your org) |
| `AZURE_SUBSCRIPTION_ID` | `a8eb4484-...` | Tells Azure *which subscription* |

These are like a mailing address — they tell Azure where to send the authentication request. They're not secrets.

### Secrets (sensitive)

| Secret | Why it's still a secret |
|--------|------------------------|
| `GOOGLE_CLIENT_ID` | OAuth app credential — not related to Azure |
| `GOOGLE_CLIENT_SECRET` | OAuth app credential — not related to Azure |
| `SESSION_SECRET` | Signs user cookies — must stay private |

**Notice:** No `AZURE_CREDENTIALS` or service principal secret anymore.

---

## Comparison: Old vs New

| | Old (Service Principal Secret) | New (Workload Identity Federation) |
|--|---|---|
| Azure secret stored in GitHub | ✅ Yes (`AZURE_CREDENTIALS` JSON) | ❌ No secret |
| Secret can leak | ✅ Yes | ❌ Not possible |
| Secret expires | ✅ Yes (needs rotation) | ❌ No expiry |
| Works from forks/PRs | ✅ Yes (dangerous!) | ❌ No (scoped to main/production) |
| Audit trail | Limited | Full (tied to specific run/branch) |
| Setup complexity | Low | Medium (one-time) |

---

## What "Entra ID" Is

Microsoft rebranded "Azure Active Directory (AAD)" to **Microsoft Entra ID** in 2023. It's Microsoft's identity platform — the system that manages:

- Who can log into Azure
- What each identity (user, app, managed identity) is allowed to do
- Trust relationships with external identity providers (like GitHub)

When we added the federated credential, we were telling Entra ID: *"Trust GitHub's OIDC server as an external identity provider, specifically for tokens claiming to be from our repo"*.

---

## Why This Is More Secure

1. **Nothing to steal** — there's no password or secret in GitHub's secret store that an attacker could exfiltrate
2. **Short-lived tokens** — the Azure access token lasts ~1 hour and is never stored anywhere
3. **Tightly scoped** — only `ahelal/fomo` on `main` branch / `production` environment can authenticate; a fork or a PR cannot
4. **Automatic** — no manual secret rotation needed, ever
5. **Auditable** — every deployment is tied to a specific GitHub run ID, actor, and commit SHA in Azure's audit logs

---

## The GitHub Actions Workflow in Plain English

```yaml
- name: Azure Login (OIDC)
  uses: azure/login@v2
  with:
    client-id: ${{ vars.AZURE_CLIENT_ID }}      # Which managed identity
    tenant-id: ${{ vars.AZURE_TENANT_ID }}       # Which Azure directory
    subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}  # Which subscription
```

This step:
1. Asks GitHub for an OIDC token for this run
2. Sends it to Azure saying "I want to act as managed identity `8e2414b5-...`"
3. Azure verifies the token and issues a temporary access token
4. All subsequent `az` CLI commands in the job use that token automatically

After that, `bash deploy.sh fomo swedencentral --yes` runs exactly like it does locally — it just uses the OIDC-issued token instead of your personal `az login` session.
