"""
Sign-in with Microsoft Entra ID (enabled with OIDC_ENABLED=true).

Roles come from Entra ID app roles in the token's "roles" claim:
  TaskRegister.Admin, TaskRegister.TMO, TaskRegister.Viewer,
  TaskRegister.Team.<CODE>   (for example TaskRegister.Team.ICT -> the "ICT Team" role; several allowed)
"""

from django.contrib.auth.models import Group
from mozilla_django_oidc.auth import OIDCAuthenticationBackend

from .roles import ADMIN, TMO, VIEWER, team_role_name

SIMPLE = {"TaskRegister.Admin": ADMIN, "TaskRegister.TMO": TMO, "TaskRegister.Viewer": VIEWER}


class EntraIDBackend(OIDCAuthenticationBackend):
    def get_userinfo(self, access_token, id_token, payload):
        info = super().get_userinfo(access_token, id_token, payload)
        info["roles"] = payload.get("roles", [])
        return info

    def filter_users_by_claims(self, claims):
        email = claims.get("email") or claims.get("preferred_username")
        return self.UserModel.objects.filter(username__iexact=email) if email else self.UserModel.objects.none()

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
            if len(parts) == 3 and parts[1] == "Team":
                names.add(team_role_name(parts[2].upper()))
        user.groups.set(Group.objects.filter(name__in=names))
        return user
