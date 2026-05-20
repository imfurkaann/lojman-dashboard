# PowerShell script to generate a self-signed cert and export PEM files for nginx
param(
  [string]$CommonName = "192.168.17.132",
  [string]$OutDir = "$(Split-Path -Parent $MyInvocation.MyCommand.Path)\..\certs"
)

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$cert = New-SelfSignedCertificate -DnsName $CommonName -CertStoreLocation "Cert:\LocalMachine\My" -NotAfter (Get-Date).AddYears(1)
$pfxPath = Join-Path $OutDir "devcert.pfx"
$keyPem = Join-Path $OutDir "key.pem"
$certPem = Join-Path $OutDir "cert.pem"

# Export PFX
$securePwd = ConvertTo-SecureString -String "devcert" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd | Out-Null

# Use OpenSSL (must be available) to extract PEM files from PFX
$openssl = "openssl"
if (-not (Get-Command $openssl -ErrorAction SilentlyContinue)) {
  Write-Host "OpenSSL not found in PATH. Install OpenSSL or run generate-dev-certs.sh in WSL." -ForegroundColor Yellow
  exit 1
}

# Extract key and cert
& $openssl pkcs12 -in $pfxPath -nocerts -nodes -passin pass:devcert -out $keyPem
& $openssl pkcs12 -in $pfxPath -clcerts -nokeys -passin pass:devcert -out $certPem

Write-Host "Generated PEM files at $OutDir"
