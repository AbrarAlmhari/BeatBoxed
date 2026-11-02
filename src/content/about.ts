/**
 * Everything the About page says, in one place: edit the text, bios, skills
 * or colours here and the page follows. Layout lives in pages/About.tsx.
 */

export type AboutIcon = 'star' | 'people' | 'chat'

export type TeamMember = {
  name: string
  /** Square picture in the middle of the record, served from public/team/. */
  photo: string
  /** Shown instead of the picture if it fails to load. */
  initials: string
  /** The record's label colour. */
  color: string
  role: string
  bio: string
  skills: string[]
  /** The full-width card at the top, with the "Team lead" badge. */
  lead?: boolean
}

export const ABOUT = {
  meta: {
    title: 'About BeatBoxed',
    description:
      'BeatBoxed is a community where music lovers rate songs, write reviews, follow people with the same taste, and understand the lyrics behind the music.',
  },

  joinLabel: 'Join BeatBoxed',

  intro: {
    eyebrow: 'About us',
    title: 'Music sounds better',
    highlight: 'when you talk about it.',
    body: 'BeatBoxed is a community where music lovers rate songs, write reviews, follow people with the same taste, and finally understand the lyrics behind the music.',
  },

  what: {
    title: 'What is BeatBoxed?',
    body: 'Not another streaming app. BeatBoxed is the place you go after the song ends, to share what it made you feel.',
    cards: [
      {
        icon: 'star',
        title: 'Rate and review',
        body: 'Give any song one to five stars, write what you think, and see how the community feels about it.',
      },
      {
        icon: 'people',
        title: 'Discover together',
        body: "Follow friends and people with your taste, find what's trending, and rate the Song of the Week with everyone.",
      },
      {
        icon: 'chat',
        title: 'Understand the lyrics',
        body: "Ask Beatie, our AI assistant, to explain a line, translate a song, or tell you what it's really about.",
      },
    ] satisfies { icon: AboutIcon; title: string; body: string }[],
  },

  why: {
    title: 'Why we built it',
    paragraphs: [
      "We kept running into the same problem: streaming apps are great for listening, but there's nowhere good to talk about music. Reviews are scattered, lyrics in other languages are hard to follow, and finding people with your taste is mostly luck.",
      'So we built the app we wanted: a home for honest reviews, real conversations about songs, and lyrics anyone can understand, in English, Arabic and beyond.',
    ],
  },

  team: {
    title: 'Meet the team',
    body: 'Seven students from the College of Computer Science and Information Technology at Imam Abdulrahman Bin Faisal University, who designed, built and tested BeatBoxed together as our Software Engineering (CSC 305) project.',
    leadBadge: 'Team lead',
    photoAlt: (name: string) => `Profile picture of ${name}`,
    members: [
      {
        name: 'Abrar Saeed Almhari',
        photo: '/team/abrar.jpg',
        initials: 'AA',
        color: '#7C3AED',
        role: 'Project Manager & Developer',
        bio: "Keeps the whole project moving: planning, the database, connecting everyone's work and getting it live, and reviewing every change before it ships. Also built playlists and the artist and album pages.",
        skills: ['Project management', 'Database design', 'React & TypeScript', 'Supabase', 'Deployment'],
        lead: true,
      },
      {
        name: 'Aseel Ehab Alashqar',
        photo: '/team/aseel-ehab.jpg',
        initials: 'AE',
        color: '#DB2777',
        role: 'Developer · Accounts & Reviews',
        bio: 'Built the heart of BeatBoxed: sign-up and log-in, ratings and reviews, comments and likes, and the onboarding that welcomes new members.',
        skills: ['Authentication', 'Reviews system', 'Onboarding', 'UX flows'],
      },
      {
        name: 'Aseel Atif Aljazzar',
        photo: '/team/aseel-atif.jpg',
        initials: 'AA',
        color: '#0891B2',
        role: 'Developer · Profiles & Social',
        bio: 'Made BeatBoxed social: profiles, following, private accounts and follow requests, and the Stats charts that show your music taste.',
        skills: ['Profiles', 'Social features', 'Data visualisation', 'Privacy'],
      },
      {
        name: 'Saja Saad Almajid',
        photo: '/team/saja.jpg',
        initials: 'SA',
        color: '#CA8A04',
        role: 'Developer of Explore & Settings',
        bio: 'Developed the Explore experience, enabling users to discover and search for songs, artists, and people. Also worked on trending content, filtering functionality, and user settings and privacy controls to create a smooth and intuitive browsing experience.',
        skills: ['Search', 'Trending', 'Settings & privacy', 'Filtering'],
      },
      {
        name: 'Retaj Hadi Al Mebti',
        photo: '/team/retaj.jpg',
        initials: 'RA',
        color: '#059669',
        role: 'Developer · Song Page & Beatie',
        bio: "Built the song page and lyrics, and brought Beatie to life: explaining lines, translating songs and chatting about the music. Abrar's right hand and biggest support throughout the project.",
        skills: ['AI integration', 'Lyrics', 'APIs', 'Prompt design'],
      },
      {
        name: 'Fatimah Fadil Aldubibi',
        photo: '/team/fatimah.jpg',
        initials: 'FA',
        color: '#EA580C',
        role: 'Developer · Home & Player',
        bio: 'Built the Home feed with For You and Following, the music player and song previews, and the Library where your music lives.',
        skills: ['Home feed', 'Music player', 'Library', 'Frontend'],
      },
      {
        name: 'Ghadah Yahya Alzahrani',
        photo: '/team/ghadah.jpg',
        initials: 'GA',
        color: '#4F46E5',
        role: 'Developer · Design & Notifications',
        bio: 'Designed the BeatBoxed logo, keeps every screen looking like one app, and built notifications so you never miss a reply or a new follower.',
        skills: ['Logo & branding', 'Design system', 'UI design', 'Notifications'],
      },
    ] satisfies TeamMember[] as TeamMember[],
  },

  builtWith: {
    title: 'Built with',
    tools: [
      'React',
      'TypeScript',
      'Tailwind CSS',
      'Supabase',
      'PostgreSQL',
      'Vercel',
      'Spotify Web API',
      'lrclib',
      'Groq',
      'Playwright',
    ],
  },

  footer: {
    credit: 'BeatBoxed · CSC 305 Software Engineering · Imam Abdulrahman Bin Faisal University · 2026',
    signoff: 'Made with love for music.',
  },
}
