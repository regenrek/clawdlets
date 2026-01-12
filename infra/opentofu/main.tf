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

variable "hcloud_token" {
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
  description = "Explicitly allow 0.0.0.0/0 or ::/0 when public_ssh is enabled (not recommended)."
}

variable "public_ssh" {
  type = bool
  default = false
}

variable "server_type" {
  type = string
  default = "cx43"
}

variable "location" {
  type = string
  default = "nbg1"
}

provider "hcloud" {
  token = var.hcloud_token
}

module "clawdbot_fleet_host" {
  source        = "./modules/bot_host"
  name          = "clawdbot-fleet-host"
  admin_cidr    = var.admin_cidr
  admin_cidr_is_world_open = var.admin_cidr_is_world_open
  ssh_key_id    = var.ssh_key_id
  public_ssh = var.public_ssh
  server_type   = var.server_type
  location      = var.location
}
