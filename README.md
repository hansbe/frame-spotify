# Frame Spotify

Viser det som spilles på Spotify som et innrammet kunstverk på Samsung The Frame: albumcoveret i et passepartout med fasekant, og en diskret tekst med sang, artist, album og år. Når ingenting har spilt på en stund, viser den en karusell med albumene du har spilt mest. Du kan også velge tom passepartout, svart skjerm eller egne bilder.

Appen er en ren nettside, publisert på Vercel (GitHub Pages fungerer også). Den logger inn direkte mot Spotify fra nettleseren (Authorization Code med PKCE), så det trengs ingen server, ingen client secret og ingen maskin som står på hjemme.

**Adresse:** https://frame-spotify.vercel.app/
**Forhåndsvisning uten Spotify:** https://frame-spotify.vercel.app/?demo=1

## Oppsett, én gang

### 1. Publisering

Siden publiseres på Vercel ved hver push til `main`. Vercel trenger ingen byggesteg: velg rammeverk *Other* og la byggekommando stå tom.

GitHub Pages er et alternativ: **Settings → Pages → Source: GitHub Actions**. Arbeidsflyten i `.github/workflows/pages.yml` publiserer da siden.

### 2. Lag en Spotify-app

1. Gå til https://developer.spotify.com/dashboard og logg inn. Kontoen må ha Premium; Spotify krever det for utviklerapper fra 2026.
2. **Create app**. Navn og beskrivelse kan være hva som helst.
3. **Redirect URI**: `https://frame-spotify.vercel.app/` — nøyaktig slik, med skråstrek til slutt. Bruker du flere adresser (f.eks. også GitHub Pages), legg inn hver av dem.
4. Kryss av for **Web API** og lagre.
5. Kopier **Client ID** og lim den inn i `config.js` (`spotifyClientId: "..."`). Client ID er ikke hemmelig og kan ligge i et offentlig repo.

Appen står i *Development Mode*. Det er nok: eieren av appen er automatisk godkjent bruker. Skal andre Spotify-kontoer i husstanden vises, legg dem til under **User Management** i appen (maks fem).

### 3. Åpne på TV-en

1. Trykk Home på fjernkontrollen, åpne **Internet** (Samsungs nettleser) og gå til adressen over.
2. Legg den til som bokmerke, eller fest den til startskjermen.
3. Velg **Koble til Spotify** og logg inn. Dette gjøres bare én gang; innloggingen fornyes automatisk etterpå.
4. Trykk OK én gang for fullskjerm.

Hvis TV-en går over til skjermsparer etter en stund, slå av **Tid for automatisk beskyttelse** (Auto Protection Time). Den ligger under Generelt i innstillingene; nøyaktig plassering varierer med modellår. Appen prøver også selv å holde skjermen våken.

## Bruk

| Fjernkontroll | Gjør |
|---|---|
| OK / opp / ned | Åpner innstillinger |
| Opp/ned i menyen | Velger linje |
| Venstre/høyre eller OK | Endrer verdi |
| Tilbake | Lukker menyen |
| Høyre (når ingenting spilles) | Neste album eller bilde |

Bruker nettleseren en peker i stedet for piltaster, åpner et klikk hvor som helst menyen.

**Innstillinger:** passepartout (varm hvit, papirhvit, steingrå, tonet etter bildet, antrasitt, sort), tekst (signatur under bildet, museumsetikett eller ingen), bildestørrelse, hva som vises når ingenting spilles, hvor lenge etter pause det byttes, lysstyrke og om skjermen skal holdes våken. Valgene lagres på enheten.

**Når ingenting spilles:**

| Valg | Viser |
|---|---|
| Mest spilte album (standard) | Albumene fra din Spotify-toppliste, ett om gangen. Velg periode (4 uker, 6 måneder, 1 år) og hvor ofte de byttes |
| Tom passepartout | Bare passepartouten |
| Svart skjerm | Ingenting |
| Egne bilder | Bildene i `art/`-mappen |

Topplisten krever tillatelsen `user-top-read`. Har du logget inn før denne kom med, ber appen deg koble til Spotify på nytt én gang.

Valgene kan også settes i adressen, f.eks. `?mat=black&label=museum&size=large`.

## Egne bilder

Velg *Egne bilder* under «Når ingenting spilles». Legg bilder i mappen `art/` i repoet. På mobilen: åpne repoet i GitHub-appen eller på github.com, gå til `art/` og velg **Add file → Upload files**. Bildene publiseres automatisk og dukker opp på TV-en innen ti minutter. På Vercel henter appen bildelisten fra GitHub-repoet (`githubRepo` i `config.js`); på GitHub Pages lages lista ved publisering.

Filnavnet blir teksten under bildet:

| Filnavn | Vises som |
|---|---|
| `Vinternatt - Harald Sohlberg, 1914.jpg` | *Vinternatt* · Harald Sohlberg, 1914 |
| `Hytta på Hvaler.jpg` | *Hytta på Hvaler* |
| `IMG_4821.jpg` | ingen tekst |

Bruk bilder i rimelig størrelse (lengste side 2000–3000 piksler holder for 4K). Eksempelbildene `Fargefelt …` kan slettes når du har lagt inn egne.

Repoet er offentlig, så bildene du legger her, er også offentlige for den som finner adressen. Bruk et privat bildearkiv for bilder som ikke skal deles.

## Som egen TV-app (valgfritt)

Mappen `tizen/` inneholder en Tizen-app som åpner samme side i fullskjerm uten adresselinje, med eget ikon på startskjermen. Det krever mer oppsett enn nettleseren:

1. Installer **Tizen Studio** med *TV Extensions* og *Samsung Certificate Extension*.
2. På TV-en: åpne **Apps**, tast `1 2 3 4 5` på fjernkontrollen, slå på **Developer mode** og skriv inn PC-ens IP-adresse. Start TV-en på nytt.
3. I Tizen Studio: lag et Samsung-sertifikat (*Certificate Manager*, profil type Samsung, med TV-ens DUID).
4. Opprett et tomt *TV Web Application*-prosjekt, erstatt `config.xml` og `icon.png` med filene i `tizen/`, bygg og kjør på TV-en via *Device Manager*.

Innloggingen må gjøres på nytt inne i TV-appen, fordi den har sin egen lagring.

## Filer

| Fil | Innhold |
|---|---|
| `index.html`, `app.css`, `app.js` | Selve appen |
| `config.js` | Spotify Client ID |
| `art/` | Egne bilder. `art.json` lages automatisk ved publisering |
| `assets/` | Papirstruktur og en liten video som holder skjermen våken |
| `demo/` | Oppdiktede cover for demomodus |
| `tizen/` | Valgfri Samsung TV-app |
| `.github/workflows/pages.yml` | Publisering til GitHub Pages |

## Feilsøking

- **«INVALID_CLIENT: Invalid redirect URI»**: Redirect URI i Spotify-appen må være nøyaktig adressen du åpner, f.eks. `https://frame-spotify.vercel.app/`.
- **«Spotify nekter tilgang»**: kontoen som logger inn er ikke eier av Spotify-appen og står ikke under *User Management*.
- **Ingenting vises når musikk spiller**: Spotify rapporterer ikke avspilling fra privat økt. Sjekk at *Privat økt* er av.
- **Logget ut etter lang tid**: velg *Koble til Spotify* i menyen og logg inn på nytt.
