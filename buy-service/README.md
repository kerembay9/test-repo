# Surround buy service

Tiny Node service that creates a horizon-pay session and redirects to checkout.
Runs on a server you control so the API key never ships to clients.

## Endpoints
- `GET /buy` → creates a 500 TL Surround Pro session, 302-redirects to PayTR.
- `GET /health` → `ok`.

## Run locally
```bash
HORIZON_PAY_API_KEY=... PORT=8787 npm start
```

## Deploy on EC2 (Amazon Linux / Ubuntu)
```bash
# 1. copy the folder
scp -i key.pem -r buy-service ec2-user@<HOST>:/tmp/surround-buy

# 2. on the box
sudo mv /tmp/surround-buy /opt/surround-buy
cd /opt/surround-buy
npm install --omit=dev          # needs Node 18+ (nvm or `sudo dnf install nodejs`)

# 3. secret env (chmod 600)
printf 'HORIZON_PAY_API_KEY=YOUR_KEY\nPORT=8787\n' | sudo tee /opt/surround-buy/.env >/dev/null
sudo chmod 600 /opt/surround-buy/.env

# 4. service
sudo cp surround-buy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now surround-buy
curl localhost:8787/health     # → ok
```

## Expose publicly (HTTPS via nginx)
Point a subdomain (e.g. `buy.horizonzeta.com`) at the instance, then:
```nginx
server {
  server_name buy.horizonzeta.com;
  location / { proxy_pass http://127.0.0.1:8787; }
  # add TLS with certbot: sudo certbot --nginx -d buy.horizonzeta.com
}
```

Then the host's Buy button opens `https://buy.horizonzeta.com/buy`.
