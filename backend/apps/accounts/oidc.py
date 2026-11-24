"""
Sign-in with Microsoft Entra ID (enabled with OIDC_ENABLED=true).

Roles come from Entra ID app roles in the token's "roles" claim:
  TaskRegister.Admin -> Admin, TaskRegister.TMO -> TMO Officer, TaskRegister.Viewer -> Global Viewer,
  and per work group (several allowed; <CODE> is the group code, for example HR):
  TaskRegister.Leader.<CODE>        -> "<CODE> Team Leader"
  TaskRegister.FocalPoint.<CODE>    -> "<CODE> Team Focal Point" (TaskRegister.Coordinator.<CODE> and
                                       TaskRegister.Team.<CODE> from earlier versions also work)
  TaskRegister.Member.<CODE>        -> "<CODE> Team Member"
An existing account is matched by its user name or its email address.
"""

from django.contrib.auth.models import Group
from django.db.models import Q
from mozilla_django_oidc.auth import OIDCAuthenticationBackend

from .roles import ADMIN, TMO, VIEWER, leader_role_name, member_role_name, team_role_name

PER_GROUP = {
    "Leader": leader_role_name,
    "FocalPoint": team_role_name,
    "Coordinator": team_role_name,
    "Team": team_role_name,
    "Member": member_role_name,
}

SIMPLE = {"TaskRegister.Admin": ADMIN, "TaskRegister.TMO": TMO, "TaskRegister.Viewer": VIEWER}


class EntraIDBackend(OIDCAuthenticationBackend):
    def get_userinfo(self, access_token, id_token, payload):
        info = super().get_userinfo(access_token, id_token, payload)
        info["roles"] = payload.get("roles", [])
        return info

    def filter_users_by_claims(self, claims):
        email = claims.get("email") or claims.get("preferred_username")
        if not email:
            return self.UserModel.objects.none()
        # Accounts created from the focal points list have a name-based user name and the member's email.
        return self.UserModel.objects.filter(Q(username__iexact=email) | Q(email__iexact=email))

    def create_user(self, claims):
        email = claims.get("email") or claims.get("preferred_username")
        user = self.UserModel.objects.create_user(username=email, email=email)
        return self.update_user(user, claims)

    def update_user(self, user, claims):
        user.first_name = claims.get("given_name", "")[:150]
        user.last_name = claims.get("family_name", "")[:150]
        user.save(update_fields=["first_name", "last_name"])
        names = set()
        for role in claims.get("roles", []):
            if role in SIMPLE:
                names.add(SIMPLE[role])
            parts = role.split(".")
            if len(parts) == 3 and parts[0] == "TaskRegister" and parts[1] in PER_GROUP:
                names.add(PER_GROUP[parts[1]](parts[2].upper()))
        user.groups.set(Group.objects.filter(name__in=names))
        return user
