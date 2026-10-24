# Spec 15 AC7 / D6: a $1 monthly budget; alert emails go to the billing account's admins at 50 %, 90 %
# and 100 % of actual spend. The only way this costs money is a bug or abuse.
resource "google_billing_budget" "guard" {
  billing_account = var.billing_account_id
  display_name    = "strength-in-numbers production: $1"

  budget_filter {
    projects = ["projects/${var.project_number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "1"
    }
  }

  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "CURRENT_SPEND"
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  depends_on = [google_project_service.enabled]
}
