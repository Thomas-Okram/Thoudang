# State Data Centre deployment

How to run Thoudang on a VM in the Manipur State Data Centre (or any on-prem Linux server) with
`docker compose`. Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Pilot: [PILOT-PLAN.md](PILOT-PLAN.md).

> **Status:** the images were written and the runtime stage was simulated locally (production-only
> dependencies, migrations, seed, health check, SPA served). They have **not yet been built with
> Docker** — do a full `docker compose build` on the target VM during the dry-run week.

## 1. What you need

| Item        | Pilot (1 district)                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM          | 4 vCPU, 8 GB RAM, Ubuntu 22.04/24.04 or RHEL 9, x86-64                                                                                                |
| Disk        | 50 GB OS + **200 GB data** (encrypted; ≈ 4 photos × 1.5 MB × 2 copies per packet → ~12 MB/packet, ~25 GB/year at 2,000/month incl. logs)              |
| Software    | Docker Engine 24+ with Compose v2.24+ (`env_file` with `required: false`)                                                                             |
| Network in  | HTTPS from the department LAN / SWAN / VPN to the SDC load balancer → VM :8080                                                                        |
| Network out | HTTPS (443) to `bedrock-runtime.ap-south-1.amazonaws.com` only (proxy allow-list). Build time only: Docker Hub + npm registry, or an internal mirror. |
| AWS         | Account in ap-south-1 with Bedrock model access for Anthropic Claude; IAM user/role limited to `bedrock:InvokeModel` on the India inference profile   |
| Backup      | SDC nightly snapshot of the Docker volumes, 30-day retention, quarterly restore test                                                                  |

## 2. Prepare the AI provider (Bedrock India)

1. In the AWS console (region **ap-south-1**), enable model access for Anthropic Claude.
2. Confirm the India inference profile ID — do not assume it:
   ```bash
   aws bedrock list-inference-profiles --region ap-south-1 \
     --query "inferenceProfileSummaries[?starts_with(inferenceProfileId,'in.anthropic')].[inferenceProfileId,inferenceProfileName]" \
     --output table
   ```
   As of Oct 2026 AWS documents `in.anthropic.claude-sonnet-5`, `in.anthropic.claude-opus-5` and
   Claude Haiku 4.5 on the India profile (Sonnet 5.5 is not listed). Use the Sonnet profile.
3. Create a least-privilege IAM policy:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["bedrock:InvokeModel"],
         "Resource": [
           "arn:aws:bedrock:ap-south-1:<ACCOUNT_ID>:inference-profile/in.anthropic.claude-sonnet-5",
           "arn:aws:bedrock:ap-south-1::foundation-model/anthropic.*",
           "arn:aws:bedrock:ap-south-2::foundation-model/anthropic.*"
         ]
       }
     ]
   }
   ```
   Attach it to a dedicated IAM user (access keys stored only in `deploy/thoudang.env`, rotated
   every 90 days). Enable CloudTrail in ap-south-1 so every model call is auditable.
4. **Before go-live:** run `npm run eval -- --dir ./eval-data` against Bedrock and compare field
   accuracy with the Anthropic-API baseline. The JSON-in-text path is new; accept only if
   accuracy is within 1 percentage point.

## 3. Install

```bash
# on the VM, as a user in the docker group
git clone <internal mirror>/thoudang.git /opt/thoudang && cd /opt/thoudang
git checkout <release tag>

cp deploy/thoudang.env.example deploy/thoudang.env
chmod 600 deploy/thoudang.env
# edit: AI_PROVIDER=bedrock, BEDROCK_MODEL_ID, CLAUDE_MODEL (= same ID), AWS keys,
#       STATUS_LINK_SECRET=$(openssl rand -hex 32)

docker compose build            # multi-stage: deps → web build → prod deps → api / web
docker compose up -d
docker compose ps               # api: healthy, web: healthy
curl -s http://127.0.0.1:8080/api/health
```

The API container on first start: creates the volume folders, copies the notice templates onto
the data volume, runs the Drizzle migrations (including the append-only audit triggers) and seeds
the name gazetteer. Re-running is safe.

> **Merge prerequisite.** `apps/api/src/server.ts` must use the provider factory for
> `AI_PROVIDER=bedrock` to take effect: apply `deploy/patches/0001-server-use-ai-provider.patch`
> (`git apply deploy/patches/0001-server-use-ai-provider.patch`) and add
> `@anthropic-ai/bedrock-sdk` to `apps/api` dependencies. Without them the API runs Anthropic-only
> and logs "serving cached extractions only" when no `ANTHROPIC_API_KEY` is set.

## 4. TLS & network

- Preferred: terminate TLS on the SDC load balancer with the department certificate and forward
  to `http://<vm>:8080`. Bind compose to the internal interface: `THOUDANG_BIND=10.x.x.x`.
- Alternative: mount the certificate into the `web` container and add a `listen 8443 ssl` server
  block to `deploy/nginx.conf`.
- Allow SSE: idle timeout on the load balancer ≥ 1 hour for `/api/events` (live queue updates).
- Phone QR upload builds its URL from the container's own IP, which is wrong inside Docker. For
  the pilot, officers upload from the desk (scanner / camera folder). Proposal in the deploy
  report: a `PUBLIC_BASE_URL` setting in `routes/sessions.ts`.

## 5. Security checklist

- [ ] `DEMO_MODE=live`, `SERVE_WEB=0` (compose enforces it) — demo reset returns 403; nginx also blocks it.
- [ ] `STATUS_LINK_SECRET` is a fresh 32-byte random value (citizen links cannot be guessed).
- [ ] `deploy/thoudang.env` is `chmod 600`, owned by root, excluded from backups shipped off-site.
- [ ] Data volumes on an **encrypted** disk (LUKS / SDC storage encryption). The `uploads`
      volume holds original photos with full Aadhaar numbers — classify it like an Aadhaar Data
      Vault, restrict host access to named administrators, and agree a retention period with the
      department (e.g. delete originals 90 days after sanction; masked extractions remain).
- [ ] Egress allow-list: only Bedrock runtime (and the e-Seba endpoint once integrated).
- [ ] Containers run non-root, read-only root FS, `no-new-privileges`, all capabilities dropped (compose).
- [ ] Demo officer accounts replaced by real users before go-live (`apps/api/src/officers.ts`
      today seeds demo officers and trusts the `X-Officer-Id` header — **put the app behind the
      department SSO / VPN until proper login is added**; see pilot risks).
- [ ] Gemini TTS left disabled (`GEMINI_API_KEY` empty) unless approved — it sends notice text abroad.
- [ ] Image vulnerability scan (`trivy image thoudang-api thoudang-web`) clean of criticals.

## 6. Operations

| Task                           | Command                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logs                           | `docker compose logs -f api` (also JSON lines in the `thoudang-logs` volume, Aadhaar-redacted)                                                                                                   |
| Health                         | `curl http://127.0.0.1:8080/api/health` — `db: ok`, `claudeConfigured: true`                                                                                                                     |
| Backup (online)                | `docker compose exec api node -e "new (require('better-sqlite3'))(process.env.DB_PATH).backup('/app/apps/api/data/backup-'+Date.now()+'.db').then(()=>console.log('ok'))"` then snapshot volumes |
| Restore                        | `docker compose down`, restore the three volumes from snapshot, `docker compose up -d`                                                                                                           |
| Upgrade                        | `git pull && git checkout <tag> && docker compose build && docker compose up -d` (migrations run automatically; take a backup first)                                                             |
| Notice templates after upgrade | The live copy is on the data volume (reviewer edits). Diff it against `packages/core/notices/templates.json` from the new release and merge new codes via `/admin/templates`.                    |
| Rotate AWS keys                | edit `deploy/thoudang.env`, `docker compose up -d api`                                                                                                                                           |
| Switch provider (incident)     | set `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` only if the department has approved processing outside India; otherwise leave Bedrock down — cases fall back to officer attention.             |

## 7. Rollback

Images are tagged by `THOUDANG_VERSION`. Build releases with
`THOUDANG_VERSION=1.0.0 docker compose build`; to roll back set the previous version and
`docker compose up -d`. Database migrations are forward-only — restore the pre-upgrade backup if a
release with a migration has to be rolled back.
