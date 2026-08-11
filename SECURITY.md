# Seguretat i gestió de secrets

## Configuració

Les credencials s'han de proporcionar mitjançant variables d'entorn injectades pel gestor de secrets de l'entorn. Copieu `.env.example` només per al desenvolupament local i no versioneu mai cap fitxer `.env`.

`JWT_SECRET` és obligatòria, ha de tenir 32 caràcters com a mínim i ha de ser diferent a cada entorn. Es pot generar, per exemple, amb `openssl rand -hex 32`.

`MQTT_STATIC_TOPICS` ha de contenir la llista de topics autoritzats, separats per comes. La subscripció global `#` es rebutja per evitar que una instància pugui llegir tot el broker.

El seeder d'administradors llegeix `ADMIN_SEEDER_USERS_JSON`. El valor ha de ser un array JSON no buit d'objectes amb `email`, `name` i una `password` d'almenys 12 caràcters. Aquest JSON conté secrets i s'ha d'injectar en temps d'execució, mai escriure'l al repositori ni a les comandes compartides.

## Rotació necessària

Eliminar un secret del codi no l'elimina de l'historial de Git. Cal considerar compromès qualsevol valor que hi hagi estat versionat i fer aquestes accions abans de desplegar els canvis:

1. Revocar i regenerar l'usuari i la contrasenya del broker MQTT.
2. Canviar les contrasenyes de tots els comptes administradors creats pel seeder antic i invalidar-ne les sessions.
3. Canviar la contrasenya del compte de prova que apareixia a la documentació.
4. Regenerar `JWT_SECRET` si el valor per defecte s'ha utilitzat en algun entorn; això invalidarà els tokens existents.
5. Revisar els logs i els gestors de configuració per detectar còpies dels valors antics.

## Resposta davant d'una nova exposició

No obriu una incidència pública amb el valor del secret. Revoqueu-lo primer, aviseu els responsables del servei afectat i substituïu-lo per una variable d'entorn. Si cal netejar l'historial, coordineu-ho amb totes les persones que mantenen còpies del repositori.
