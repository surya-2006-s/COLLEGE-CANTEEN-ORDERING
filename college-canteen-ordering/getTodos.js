import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hsweqjifv...supabase.co'
const supabaseKey = 'eyJhbGc...'


const supabase = createClient(supabaseUrl, supabaseKey)

async function fetchTodos() {
  console.log("Fetching data...")
  const { data, error } = await supabase
    .from('todos')
    .select('*')

  if (error) {
    console.log('Error fetching data:', error.message)
  } else {
    console.log('✅ Data fetched successfully!')
    console.log('Here is your data:', data)
  }
}

fetchTodos()
