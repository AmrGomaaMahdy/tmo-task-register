from django.conf import settings
from django.db import models
from django.utils import timezone

# Users are Django's built-in users. Roles (including the per-work-group team roles) are Django groups;
# see apps/accounts/roles.py.


class SecuritySettings(models.Model):
    """
    System settings an administrator changes on the System settings page. One row (pk=1); every policy has
    its own on/off switch. Read through apps/accounts/policy.py (cached for a few seconds).

    Outgoing email   the SMTP server for sign-in codes and notices. Off: the server's environment
                     (EMAIL_HOST …) is used, if set. The password is stored encrypted.
    Email code       after the password, a code is emailed and must be entered (multi-factor).
    Password expiry  a password must be changed after so many days.
    Password length  the minimum length of a new password.
    Sign-out         after so many minutes without activity, and at the latest so many hours after
                     signing in.
    """

    class SmtpSecurity(models.TextChoices):
        STARTTLS = "starttls", "STARTTLS (port 587)"
        SSL = "ssl", "SSL/TLS (port 465)"
        NONE = "none", "None"

    # Outgoing email
    email_enabled = models.BooleanField(default=False)
    smtp_host = models.CharField(max_length=200, blank=True)
    smtp_port = models.PositiveIntegerField(default=587)
    smtp_security = models.CharField(max_length=10, choices=SmtpSecurity.choices, default=SmtpSecurity.STARTTLS)
    smtp_user = models.CharField(max_length=200, blank=True)
    smtp_password_enc = models.TextField(blank=True)
    from_email = models.CharField(max_length=200, blank=True)
    # Email code at sign-in
    mfa_email_enabled = models.BooleanField(default=False)
    mfa_code_minutes = models.PositiveSmallIntegerField(default=10)
    # Passwords
    password_expiry_enabled = models.BooleanField(default=False)
    password_expiry_days = models.PositiveSmallIntegerField(default=90)
    password_length_enabled = models.BooleanField(default=True)
    password_min_length = models.PositiveSmallIntegerField(default=12)
    # Automatic sign-out
    idle_timeout_enabled = models.BooleanField(default=True)
    idle_timeout_minutes = models.PositiveIntegerField(default=60)
    session_limit_enabled = models.BooleanField(default=True)
    session_limit_hours = models.PositiveIntegerField(default=10)

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        verbose_name = "system settings"
        verbose_name_plural = "system settings"

    def __str__(self) -> str:
        return "System settings"

    @classmethod
    def current(cls) -> "SecuritySettings":
        obj, created = cls.objects.get_or_create(
            pk=1,
            defaults={
                "idle_timeout_minutes": getattr(settings, "SESSION_IDLE_MINUTES", 60),
                "session_limit_hours": getattr(settings, "SESSION_ABSOLUTE_HOURS", 10),
            },
        )
        return obj


class AccountSecurity(models.Model):
    """Per account: when the password was last set, and whether it must be changed at the next sign-in."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="security")
    password_changed_at = models.DateTimeField(default=timezone.now)
    must_change_password = models.BooleanField(default=False)

    def __str__(self) -> str:
        return f"{self.user} password set {self.password_changed_at:%Y-%m-%d}"

    @classmethod
    def of(cls, user) -> "AccountSecurity":
        # An account seen for the first time starts counting now, so switching expiry on never locks
        # everybody out at once.
        obj, _ = cls.objects.get_or_create(user=user)
        return obj


class LeaderDelegation(models.Model):
    """
    A work group leader away for a while names a delegate, who decides on the group's tasks and links in
    the leader's place from `starts_on` to `ends_on` (both included, Riyadh dates). The delegate approves
    and rejects only: editing the register stays with the group. The leader keeps their own rights.
    Cancelling ends it at once; past and cancelled delegations stay as a record.
    """

    work_group = models.ForeignKey("masterdata.WorkGroup", on_delete=models.CASCADE, related_name="delegations")
    leader = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="delegations_given")
    delegate = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="delegations_received"
    )
    starts_on = models.DateField()
    ends_on = models.DateField()
    note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["-starts_on", "-id"]
        indexes = [models.Index(fields=["delegate", "starts_on", "ends_on"])]

    def __str__(self) -> str:
        return f"{self.delegate} for {self.leader} ({self.work_group}) {self.starts_on}–{self.ends_on}"

    @property
    def state(self) -> str:
        today = timezone.localdate()
        if self.cancelled_at:
            return "cancelled"
        if self.ends_on < today:
            return "ended"
        if self.starts_on > today:
            return "upcoming"
        return "active"

    @classmethod
    def active(cls):
        today = timezone.localdate()
        return cls.objects.filter(cancelled_at__isnull=True, starts_on__lte=today, ends_on__gte=today)
