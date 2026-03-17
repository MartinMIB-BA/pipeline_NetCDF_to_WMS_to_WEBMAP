#!/usr/bin/env python3
"""Send email notifications via Gmail SMTP (no mail server required)."""

import os
import sys
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime


def send_email(
    subject: str,
    body: str,
    to_email: str,
    from_email: str,
    app_password: str,
    log_file: str = None,
    success: bool = True
):
    """
    Send email via Gmail SMTP.
    
    Args:
        subject: Email subject
        body: Email body (plain text)
        to_email: Recipient email
        from_email: Sender Gmail address
        app_password: Gmail App Password (16 characters)
        log_file: Optional path to log file to attach
        success: Whether this is a success or failure notification
    """
    # Create message
    msg = MIMEMultipart()
    msg['From'] = from_email
    msg['To'] = to_email
    msg['Subject'] = f"{'✅ SUCCESS' if success else '❌ FAILED'}: {subject}"
    
    # Add body
    msg.attach(MIMEText(body, 'plain'))
    
    # Attach log file if provided
    if log_file and os.path.exists(log_file):
        try:
            with open(log_file, 'rb') as f:
                part = MIMEBase('application', 'octet-stream')
                part.set_payload(f.read())
                encoders.encode_base64(part)
                part.add_header(
                    'Content-Disposition',
                    f'attachment; filename={os.path.basename(log_file)}'
                )
                msg.attach(part)
        except Exception as e:
            print(f"Warning: Could not attach log file: {e}")
    
    # Send email via Gmail SMTP
    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(from_email, app_password)
        server.send_message(msg)
        server.quit()
        print(f"✅ Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"❌ Failed to send email: {e}")
        return False


def main():
    """Send WMS processing notification email."""
    # Get configuration from environment or command line
    to_email = os.getenv('EMAIL_TO', 'martin.jancovic01@gmail.com')
    from_email = os.getenv('EMAIL_FROM', 'martin.jancovic01@gmail.com')
    app_password = os.getenv('GMAIL_APP_PASSWORD', '')
    
    if not app_password:
        print("❌ Error: GMAIL_APP_PASSWORD not set in environment")
        sys.exit(1)
    
    # Get status from command line args
    if len(sys.argv) < 3:
        print("Usage: send_email_notification.py <subject> <body> [log_file] [success|failed]")
        sys.exit(1)
    
    subject = sys.argv[1]
    body = sys.argv[2]
    log_file = sys.argv[3] if len(sys.argv) > 3 else None
    success = sys.argv[4].lower() != 'failed' if len(sys.argv) > 4 else True
    
    # Send email
    send_email(subject, body, to_email, from_email, app_password, log_file, success)


if __name__ == '__main__':
    main()
