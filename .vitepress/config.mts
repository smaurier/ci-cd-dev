import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'CI/CD & DevOps',
  description: 'CI/CD & DevOps : GitHub Actions, Docker, registries, déploiement, preview envs, sécurité pipeline, IaC, DORA',
  lang: 'fr-FR',
  srcDir: '.',

  vite: {
    server: {
      port: 5180,
      strictPort: false
    }
  },

  // Docs statiques : neutralise l'interpolation Vue `{{ }}` en prose (et les `${{ }}`
  // GitHub Actions) pour ne pas casser le build SSR.
  vue: {
    template: {
      compilerOptions: {
        delimiters: ['(%(', ')%)']
      }
    }
  },

  ignoreDeadLinks: true,

  srcExclude: ['quizzes/**'],

  themeConfig: {
    nav: [
      { text: 'Modules', link: '/modules/00-introduction-cicd' },
      { text: 'Labs', link: '/labs/lab-00-introduction-cicd/README' }
    ],

    sidebar: {
      '/modules/': [
        {
          text: 'CI/CD & DevOps',
          items: [
            { text: '00 · Introduction CI/CD', link: '/modules/00-introduction-cicd' },
            { text: '01 · GitHub Actions — fondamentaux', link: '/modules/01-github-actions-fondamentaux' },
            { text: '02 · GitHub Actions — avancé', link: '/modules/02-github-actions-avance' },
            { text: '03 · Tester dans la CI', link: '/modules/03-testing-dans-ci' },
            { text: '04 · Conteneurisation en CI', link: '/modules/04-conteneurisation-ci' },
            { text: '05 · Artefacts & registries', link: '/modules/05-artefacts-registries' },
            { text: '06 · Stratégies de déploiement', link: '/modules/06-strategies-deploiement' },
            { text: '07 · Preview environments', link: '/modules/07-preview-environments' },
            { text: '08 · Sécurité des pipelines', link: '/modules/08-securite-pipelines' },
            { text: '09 · Infrastructure as Code', link: '/modules/09-iac-introduction' },
            { text: '10 · Monitoring des pipelines (DORA)', link: '/modules/10-monitoring-pipelines' },
            { text: '11 · Projet final', link: '/modules/11-projet-final' }
          ]
        }
      ],
      '/labs/': [
        {
          text: 'Labs — pratique',
          items: [
            { text: 'Lab 00 · Introduction CI/CD', link: '/labs/lab-00-introduction-cicd/README' },
            { text: 'Lab 01 · GHA fondamentaux', link: '/labs/lab-01-github-actions-fondamentaux/README' },
            { text: 'Lab 02 · GHA avancé', link: '/labs/lab-02-github-actions-avance/README' },
            { text: 'Lab 03 · Tests en CI', link: '/labs/lab-03-testing-dans-ci/README' },
            { text: 'Lab 04 · Conteneurisation', link: '/labs/lab-04-conteneurisation-ci/README' },
            { text: 'Lab 05 · Artefacts & registries', link: '/labs/lab-05-artefacts-registries/README' },
            { text: 'Lab 06 · Stratégies de déploiement', link: '/labs/lab-06-strategies-deploiement/README' },
            { text: 'Lab 07 · Preview environments', link: '/labs/lab-07-preview-environments/README' },
            { text: 'Lab 08 · Sécurité des pipelines', link: '/labs/lab-08-securite-pipelines/README' },
            { text: 'Lab 09 · Infrastructure as Code', link: '/labs/lab-09-iac-introduction/README' },
            { text: 'Lab 10 · Monitoring (DORA)', link: '/labs/lab-10-monitoring-pipelines/README' },
            { text: 'Lab 11 · Projet final', link: '/labs/lab-11-projet-final/README' }
          ]
        }
      ]
    },

    search: { provider: 'local' },
    outline: { level: [2, 3], label: 'Sur cette page' },
    docFooter: { prev: 'Précédent', next: 'Suivant' }
  }
})
