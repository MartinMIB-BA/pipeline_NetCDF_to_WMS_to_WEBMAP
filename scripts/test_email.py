#!/usr/bin/env python3
"""Quick test script to verify Gmail SMTP configuration."""

import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from pathlib import Path

# Load .env file if it exists
env_file = Path(__file__).parent / '.env'
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip()

def test_email_config():
    """Test email configuration by sending a test email."""
    
    # Get config from environment
    email_to = os.environ.get("EMAIL_TO", "martin.jancovic01@gmail.com")
    email_from = os.environ.get("EMAIL_FROM", "martin.jancovic01@gmail.com")
    gmail_password = os.environ.get("GMAIL_APP_PASSWORD")
    
    if not gmail_password:
        print("❌ Error: GMAIL_APP_PASSWORD not set in environment")
        return False
    
    # Remove spaces from password (Gmail App Passwords have spaces)
    gmail_password = gmail_password.replace(" ", "")
    
    print("📧 Email Configuration Test")
    print("=" * 50)
    print(f"From: {email_from}")
    print(f"To: {email_to}")
    print(f"Password: {'*' * len(gmail_password)} ({len(gmail_password)} chars)")
    print("=" * 50)
    
    # Create test email
    msg = MIMEMultipart()
    msg['From'] = email_from
    msg['To'] = email_to
    msg['Subject'] = f"🧪 Email Test - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    
    body = f"""
    ✅ Email Configuration Test Successful!
    
    This is a test email to verify your Gmail SMTP configuration.
    
    Configuration:
    - From: {email_from}
    - To: {email_to}
    - Server: smtp.gmail.com:587
    - Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
    
    If you received this email, your WMS email notifications are configured correctly! 🎉
    """
    
    msg.attach(MIMEText(body, 'plain'))
    
    try:
        print("\n📤 Connecting to Gmail SMTP server...")
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        
        print("🔐 Authenticating...")
        server.login(email_from, gmail_password)
        
        print("📨 Sending test email...")
        server.send_message(msg)
        server.quit()
        
        print("\n✅ SUCCESS! Test email sent successfully!")
        print(f"📬 Check your inbox at {email_to}")
        return True
        
    except smtplib.SMTPAuthenticationError as e:
        print("\n❌ AUTHENTICATION FAILED!")
        print(f"   Error: {e}")
        print("\n💡 Tips:")
        print("   1. Make sure you're using a Gmail App Password, not your regular password")
        print("   2. App Passwords: https://myaccount.google.com/apppasswords")
        print("   3. Check that spaces are included in the password (they will be removed automatically)")
        return False
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        return False

if __name__ == "__main__":
    test_email_config()
