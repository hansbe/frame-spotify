// Innstillinger for Frame Spotify.
// Client ID er ikke hemmelig. Den finnes i appen din på https://developer.spotify.com/dashboard
window.FRAME_CONFIG = {
  spotifyClientId: "",

  // Må være identisk med Redirect URI i Spotify-appen.
  // null = adressen siden ligger på, f.eks. https://hansbe.github.io/frame-spotify/
  redirectUri: null
};
