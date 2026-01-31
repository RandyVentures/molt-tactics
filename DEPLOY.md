# Deployment Guide (VPS)

This runbook deploys MoltTactics on a small VPS (Ubuntu/Debian). It uses a single Node server + optional Next.js viewer behind Nginx.

## 1) Provision VPS
- Ubuntu 22.04+ recommended.
- Open ports 22, 80, 443.

## 2) Install system packages
```
sudo apt update
sudo apt install -y git nginx
```

## 3) Install Node.js 18+
```
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

## 4) Clone repo
```
git clone https://github.com/RandyVentures/molt-tactics.git
cd molt-tactics
```

## 5) Install server deps
```
cd server
npm install
```

## 6) Create environment file
Create `/etc/molt-tactics.env`:
```
PORT=3000
TURN_MS=15000
USE_SQLITE=1
DB_PATH=/opt/molt-tactics/data/molt.db
AUTH_DISABLED=0
```

Create data directory:
```
sudo mkdir -p /opt/molt-tactics/data
sudo chown $USER:$USER /opt/molt-tactics/data
```

## 7) Systemd service
Create `/etc/systemd/system/molt-tactics.service`:
```
[Unit]
Description=MoltTactics Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/ubuntu/molt-tactics/server
EnvironmentFile=/etc/molt-tactics.env
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable + start:
```
sudo systemctl daemon-reload
sudo systemctl enable molt-tactics
sudo systemctl start molt-tactics
sudo systemctl status molt-tactics
```

## 8) Nginx reverse proxy
Create `/etc/nginx/sites-available/molt-tactics`:
```
server {
  listen 80;
  server_name YOUR_DOMAIN_OR_IP;

  location /api/ {
    proxy_pass http://127.0.0.1:3000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  # Static viewer (optional)
  root /home/ubuntu/molt-tactics/web;
  location / {
    try_files $uri /index.html;
  }
}
```

Enable site:
```
sudo ln -s /etc/nginx/sites-available/molt-tactics /etc/nginx/sites-enabled/molt-tactics
sudo nginx -t
sudo systemctl restart nginx
```

## 9) SSL (optional)
```
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
```

## 10) Next.js viewer (optional)
```
cd /home/ubuntu/molt-tactics/web-next
npm install
npm run build
npm run start -- --port 3001
```
Then proxy / to `http://127.0.0.1:3001` instead of static files.

## 11) Backups
- SQLite DB: `/opt/molt-tactics/data/molt.db`
- JSON data (if not using SQLite): `server/data/`

## 12) Health checks
```
curl http://YOUR_DOMAIN/api/leaderboard
curl http://YOUR_DOMAIN/api/matches
```
