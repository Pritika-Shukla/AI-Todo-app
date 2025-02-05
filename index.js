import { eq, ilike } from "drizzle-orm";
import { db } from "./db/index.js";
import { todoTable } from "./db/schema.js";
import OpenAI from "openai";
import readlineSync from "readline-sync"; // ✅ Fixed import

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

async function getAllTodos() {
    const todos = await db.select().from(todoTable);
    return todos;
}

async function createTodo(todo) {
    const [newTodo] = await db.insert(todoTable).values({
        todo,
    }).returning({
        id: todoTable.id
    });
    return newTodo.id;
}

async function search(search) {
    const todos = await db.select().from(todoTable).where(ilike(todoTable.todo, `%${search}%`));
    return todos;
}

async function deleteById(id) {
    await db.delete(todoTable).where(eq(todoTable.id, id));
    return `Todo with ID ${id} deleted successfully.`;
}

const tools = {
    getAllTodos,
    createTodo,
    search,
    deleteById
};

const SYSTEM_PROMPT = `
You are an AI To-Do List Assistant with START, PLAN, ACTION, Observation, and Output State.
Wait for the user prompt and first PLAN using available tools.
After Planning, take the action with appropriate tools and wait for Observation based on Action.
Once you get the observations, Return the AI response based on START prompt and observations.

You can manage tasks by adding, viewing, updating, and deleting them.
You must strictly follow the JSON output format.

Todo DB Schema:
id: Int and Primary Key
todo: String
created_at: Date Time
updated_at: Date Time

Available Tools:
- getAllTodos(): Returns all the Todos from Database
- createTodo(todo: string): Creates a new Todo in the DB and takes todo as a string
- deleteById(id: string): Deletes the todo by ID given in the DB
- search(query: string): Searches for all todos matching the query string using iLike in DB

Example:
START
{ "type": "user", "user": "Add a task for shopping groceries." }
{ "type": "plan", "plan": "I will try to get more context on what user needs to shop." }
{ "type": "output", "output": "Can you tell me what all items you want to shop for?" }
{ "type": "user", "user": "I want to shop for milk, kurkure, lays, and chocolate" }
{ "type": "plan", "plan": "I will use createTodo to create a new Todo in DB." }
{ "type": "action", "function": "createTodo", "input": "Shopping: Milk, Kurkure, Lays, and Chocolate"  }
{ "type": "observation", "observation": "2" }
{ "type": "output", "output": "Your todo has been added" }
`;

const message = [{ role: 'system', content: SYSTEM_PROMPT }];

while (true) {
    const query = readlineSync.question('>> ');

    const userMessage = {
        type: 'user',
        user: query,
    };

    message.push({ role: 'user', content: JSON.stringify(userMessage) });

    while (true) {
        const chat = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: message,
            response_format: "json", 
        });

        const result = chat.choices[0].message.content;
        message.push({ role: 'assistant', content: result });

        const action = JSON.parse(result);

        if (action.type === 'output') {
            console.log(`${action.output}`);
            break;
        } else if (action.type === 'action') {
            const fn = tools[action.function];

            if (!fn) {
                console.error(`Invalid function: ${action.function}`);
                break;
            }

            try {
                const observation = await fn(action.input);
                const observationMessage = {
                    type: 'observation',
                    observation: observation,
                };
                message.push({ role: 'developer', content: JSON.stringify(observationMessage) });
            } catch (error) {
                console.error(`Error executing function ${action.function}: ${error.message}`);
                break;
            }
        }
    }
}
