terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hcloud = {
      source = "hetznercloud/hcloud"
      version = ">= 1.50.0"
    }
  }
}

# State migration: older versions of this repo managed the Hetzner SSH key as a
# OpenTofu/Terraform resource. That caused re-provisioning failures (409 uniqueness) and
# could risk deleting a shared key on apply. We now pass `ssh_key_id` in.
removed {
  from = hcloud_ssh_key.admin
  lifecycle {
    destroy = false
  }
}

variable "host_name" {
  type = string
}

variable "ssh_key_id" {
  type = string
}

variable "admin_cidr" {
  type = string
}

variable "admin_cidr_is_world_open" {
  type = bool
  default = false
  description = "Explicitly allow 0.0.0.0/0 or ::/0 when SSH exposure is enabled (not recommended)."
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
  default = "tailscale"
  validation {
    condition     = contains(["none", "tailscale"], var.tailnet_mode)
    error_message = "tailnet_mode must be one of: none, tailscale"
  }
}

variable "server_type" {
  type = string
  default = "cx43"
}

variable "image" {
  type = string
  default = "debian-12"
}

variable "location" {
  type = string
  default = "nbg1"
}

provider "hcloud" {}

module "clawdbot_fleet_host" {
  source        = "./modules/bot_host"
  name          = var.host_name
  admin_cidr    = var.admin_cidr
  admin_cidr_is_world_open = var.admin_cidr_is_world_open
  ssh_key_id    = var.ssh_key_id
  ssh_exposure_mode = var.ssh_exposure_mode
  tailnet_mode      = var.tailnet_mode
  server_type   = var.server_type
  image         = var.image
  location      = var.location
}
