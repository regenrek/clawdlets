terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = ">= 1.50.0"
    }
  }
}

variable "name" {
  type = string
}

variable "location" {
  type = string
  default = "nbg1"
}

variable "server_type" {
  type = string
  default = "cx43"
}

variable "image" {
  type = string
  default = "debian-12"
}

variable "admin_cidr" {
  type = string
}

variable "admin_cidr_is_world_open" {
  type = bool
  default = false
  description = "Explicitly allow 0.0.0.0/0 or ::/0 when SSH exposure is enabled (not recommended)."
}

variable "ssh_key_id" {
  type = string
}

variable "ssh_exposure_mode" {
  type = string
  default = "tailnet"
  validation {
    condition     = contains(["tailnet", "bootstrap", "public"], var.ssh_exposure_mode)
    error_message = "ssh_exposure_mode must be one of: tailnet, bootstrap, public"
  }
}

variable "tailnet_mode" {
  type = string
  default = "none"
  validation {
    condition     = contains(["none", "tailscale"], var.tailnet_mode)
    error_message = "tailnet_mode must be one of: none, tailscale"
  }
}

locals {
  ssh_ingress_enabled = var.ssh_exposure_mode != "tailnet"
  tailscale_udp_enabled = var.tailnet_mode == "tailscale"
}

resource "hcloud_firewall" "base" {
  name = "${var.name}-base-fw"

  dynamic "rule" {
    for_each = local.tailscale_udp_enabled ? [1] : []
    content {
      direction   = "in"
      protocol    = "udp"
      port        = "41641"
      source_ips  = ["0.0.0.0/0", "::/0"]
      description = "Tailscale WireGuard UDP (direct connections)"
    }
  }
}

resource "hcloud_firewall" "ssh" {
  count = local.ssh_ingress_enabled ? 1 : 0
  name  = "${var.name}-ssh-fw"

  lifecycle {
    precondition {
      condition = (
        !local.ssh_ingress_enabled ||
        var.admin_cidr_is_world_open ||
        (var.admin_cidr != "0.0.0.0/0" && var.admin_cidr != "::/0")
      )
      error_message = "refusing to open SSH with admin_cidr=0.0.0.0/0 (or ::/0); set admin_cidr_is_world_open=true to override"
    }
  }

  rule {
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = [var.admin_cidr]
    description = "SSH ${var.ssh_exposure_mode} from admin CIDR"
  }
}

resource "hcloud_server" "vm" {
  name        = var.name
  server_type = var.server_type
  location    = var.location
  image       = var.image

  ssh_keys     = [var.ssh_key_id]
  firewall_ids = concat(
    [hcloud_firewall.base.id],
    local.ssh_ingress_enabled ? [hcloud_firewall.ssh[0].id] : [],
  )
}

output "ipv4" {
  value = hcloud_server.vm.ipv4_address
}
