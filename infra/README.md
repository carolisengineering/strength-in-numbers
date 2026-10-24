# infra — production on Google Cloud (Spec 15)

Terraform for the free-tier production environment: Cloud Run, Artifact Registry, Secret Manager, Firebase Hosting, the keyless CI identity and a $1 budget.
Applied by hand from the owner's machine, see `docs/runbooks/first-deploy.md` Part F.
Never applied from CI: the `infra` job only runs `fmt`, `init -backend=false` and `validate`.
