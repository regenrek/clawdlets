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
  description = "Explicitly allow 0.0.0.0/0 or ::/0 when public_ssh is enabled (not recommended)."
}

variable "ssh_key_id" {
  type = string
}

variable "public_ssh" {
  type = bool
  default = false
}

resource "hcloud_firewall" "fw" {
  name = "${var.name}-fw"

  lifecycle {
    precondition {
      condition = (!var.public_ssh)
        || var.admin_cidr_is_world_open
        || (var.admin_cidr != "0.0.0.0/0" && var.admin_cidr != "::/0")
      error_message = "refusing to open public SSH with admin_cidr=0.0.0.0/0 (or ::/0); set admin_cidr_is_world_open=true to override"
    }
  }

  dynamic "rule" {
    for_each = var.public_ssh ? [1] : []
    content {
      direction   = "in"
      protocol    = "tcp"
      port        = "22"
      source_ips  = [var.admin_cidr]
      description = "Public SSH from admin CIDR"
    }
  }
}

resource "hcloud_server" "vm" {
  name        = var.name
  server_type = var.server_type
  location    = var.location
  image       = var.image

  ssh_keys     = [var.ssh_key_id]
  firewall_ids = [hcloud_firewall.fw.id]
}

output "ipv4" {
  value = hcloud_server.vm.ipv4_address
}
