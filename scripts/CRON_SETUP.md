# Inštalácia Cron Job pre WMS Processing

## Čo som vytvoril

1. ✅ [`wms_crontab.txt`](file:///Users/martinjancovic/Desktop/WMS_WMS_T/scripts/wms_crontab.txt) - Konfigurácia pre automatické spustenie

## Rozpis behu

| Čas | Script | Log súbor | Email label |
|-----|--------|-----------|-------------|
| **08:00** | `run_wms_with_email.sh` | `/home/martin/logs/wms_8am.log` | "8am" |
| **14:00** | `run_wms_with_email.sh` | `/home/martin/logs/wms_2pm.log` | "2pm" |
| **20:00** | `run_wms_with_email.sh` | `/home/martin/logs/wms_8pm.log` | "8pm" |
| **09:00** | `monitor_storage.sh` | `/home/martin/logs/storage_monitor.log` | - |

## Ako nainštalovať na server

**Na serveri `martin@vmi2540215` spustite:**

```bash
# 1. Prejdite do adresára
cd ~/scripts

# 2. Vytvorte logs adresár (ak neexistuje)
mkdir -p ~/logs

# 3. Nainštalujte crontab
crontab wms_crontab.txt

# 4. Overte, že sa nastavil
crontab -l
```

## Overenie

Po inštalácii môžete:

```bash
# Pozrieť aktuálne nastavené cron joby
crontab -l

# Sledovať cron logy
tail -f ~/logs/cron.log

# Vyskúšať manuálne (bez čakania na cron)
bash run_wms_with_email.sh ~/logs/test.log "manual-test"
```

## Čo bude robiť

- **WMS Processing** sa spustí 3× denne automaticky
- Po každom behu dostanete **email** s výsledkom (úspech/chyba)
- Logy sa ukladajú do `/home/martin/logs/`
- Každý beh má **vlastný log súbor** podľa času

## Dôležité

> [!IMPORTANT]
> Uistite sa, že máte **GMAIL_APP_PASSWORD** nastavený v `/home/martin/scripts/.env` na serveri!

```bash
# Skontrolujte .env na serveri
cat ~/scripts/.env | grep GMAIL_APP_PASSWORD
```
