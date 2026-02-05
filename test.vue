<template>
  <div>
    <h1>{{ title }}</h1>
    <p>{{ message }}</p>
    <button @click="handleClick">{{ buttonText }}</button>
    <input v-model="inputValue" :placeholder="$t('common.test.enter-text.f772d1')" />
  </div>
</template>

<script>
export default {
  name: 'TestComponent',
  data() {
    return {
      title: 'Welcome to Vue.js',
      message: 'This is a test component',
      buttonText: 'Click me',
      inputValue: ''
    }
  },
  methods: {
    handleClick() {
      console.log('Button clicked')
    }
  }
}
</script>

<style scoped>
div {
  padding: 20px;
}
</style>